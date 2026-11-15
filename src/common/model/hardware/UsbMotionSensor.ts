/**
 * UsbMotionSensor.ts
 *
 * WebUSB client for the PS-3219, which the manual calls "a combination wireless
 * and USB sensor". The PASCO packets are identical to the Bluetooth ones — only
 * the envelope differs, and that lives in `PascoMotionProtocol`. See
 * doc/implementation-notes.md for where the framing was recovered from.
 *
 * ── Request/response, not notifications ───────────────────────────────────────
 * USB has no GATT subscribe. Every exchange is one write on the OUT endpoint
 * followed by one read of the IN endpoint, so unlike the Bluetooth client there
 * is no notification handler and no pending-callback bookkeeping; each command
 * awaits its own answer.
 *
 * ── The bridge must be enabled first ──────────────────────────────────────────
 * Claiming the interface is not sufficient. Until the vendor control transfer
 * in `wakeBridge` arrives, both endpoints accept writes and answer nothing at
 * all — which looks exactly like a protocol error and is not one.
 */

import { DeviceSelectionCancelled, type TMotionSensorDevice } from "./MotionSensorDevice.js";
import {
  AcknowledgedCommand,
  type AcknowledgedCommandValue,
  decodeCommandAck,
  decodeMotionNotification,
  decodeStreamPacket,
  isResultPacket,
  keepaliveCommand,
  MOTION_SENSOR_SERVICE_ID,
  type MotionRangeValue,
  PASCO_CHARACTERISTIC,
  PASCO_DEVICE_SERVICE_ID,
  readMotionSampleCommand,
  STREAM_ACK_INTERVAL,
  setRangeCommand,
  setSamplePeriodCommand,
  startSamplingCommand,
  stopSamplingCommand,
  streamAckCommand,
  usbPacketBody,
  usbWriteFrame,
} from "./PascoMotionProtocol.js";

/** PASCO scientific. The only filter SPARKvue's own WebUSB picker applies. */
const PASCO_USB_VENDOR_ID = 0x0945;

/**
 * Fallback transfer size, replaced at connect by the IN endpoint's own
 * `packetSize`. A PS-3219 reports 64, which is also the OUT endpoint's limit
 * and hence the 62-byte payload cap in `PascoMotionProtocol`.
 */
const TRANSFER_BYTES = 64;

/** How long to keep reading the IN endpoint before giving up on an answer. */
const READ_DEADLINE_MS = 500;

/** Header plus a result packet's opcode triple. */
const MINIMUM_PACKET_BYTES = 5;

/**
 * Consecutive failed reads the stream tolerates before the read loop gives up.
 * One bad transfer among a hundred good ones should cost a sample, not the run;
 * three in a row at a 500 ms deadline means the device has genuinely gone quiet.
 */
const STREAM_FAILURE_TOLERANCE = 3;

/**
 * Vendor control requests the bridge wants before it will carry bulk traffic.
 * Captured from SPARKvue: it reads three descriptors and then writes one
 * enable, and until that enable arrives both endpoints stay completely silent.
 */
const BRIDGE = {
  STATUS: 0xed,
  CONFIG: 0xa0,
  VERSION: 0xf2,
  ENABLE: 0xfb,
  CONFIG_VALUE: 0x01fc,
  CONFIG_INDEX: 0x1000,
  ENABLE_INDEX: 0x3500,
} as const;

export type UsbMotionSensorOptions = {
  /**
   * Drop the vendor filter so the picker lists every USB device. For bring-up
   * only: it is the one way to find out what the sensor actually enumerates as
   * when the filtered picker comes up empty.
   */
  readonly acceptAllDevices?: boolean;
  /** Log the chosen device's descriptors, which say why a claim will or won't work. */
  readonly logDetails?: boolean;
  /**
   * Open and claim the device, report its descriptors, and send nothing at all.
   * A PS-3219 can be wedged off the bus by transfers it does not like, so the
   * first look at unfamiliar hardware should cost it nothing.
   */
  readonly probeOnly?: boolean;
};

export class UsbMotionSensor implements TMotionSensorDevice {
  private device: USBDevice | null = null;
  private inEndpoint = 0;
  private outEndpoint = 0;
  private exchanging = false;
  /**
   * True from the moment START_SAMPLING goes out until STOP_SAMPLING does —
   * the device's state, not the host's. Kept separate from {@link draining}
   * because the read loop can end for reasons that leave the device happily
   * ranging on its own clock, and only this flag says a stop is still owed.
   */
  private deviceIsSampling = false;
  /** True while the read loop should keep draining what the device pushes. */
  private draining = false;

  private readonly onUnexpectedDisconnect: () => void;
  private readonly handleDisconnect: (event: USBConnectionEvent) => void;
  private readonly acceptAllDevices: boolean;
  private readonly logDetails: boolean;
  private readonly probeOnly: boolean;
  /** Largest transfer the IN endpoint will accept, from its descriptor. */
  private inPacketBytes = TRANSFER_BYTES;
  /**
   * The one IN transfer the browser is holding for us, if any. WebUSB cannot
   * cancel a transfer, so one that outruns its deadline is kept here and awaited
   * again by the next read rather than abandoned — see {@link transferIn}.
   */
  private pendingIn: Promise<USBInTransferResult> | null = null;

  /** Raw bytes of the last IN transfer, for `?showDiagnostics=true`. */
  public diagnosticText = "";

  public constructor(onUnexpectedDisconnect: () => void, options?: UsbMotionSensorOptions) {
    this.onUnexpectedDisconnect = onUnexpectedDisconnect;
    this.acceptAllDevices = options?.acceptAllDevices === true;
    this.logDetails = options?.logDetails === true;
    this.probeOnly = options?.probeOnly === true;
    this.handleDisconnect = (event: USBConnectionEvent) => {
      if (event.device === this.device) {
        this.device = null;
        this.onUnexpectedDisconnect();
      }
    };
  }

  public get isConnected(): boolean {
    return this.device?.opened === true;
  }

  public get name(): string | null {
    const device = this.device;
    if (!device) {
      return null;
    }
    return device.productName ?? `PASCO ${device.productId}`;
  }

  /**
   * Opens the browser's device picker and claims the interface. Never awaits
   * anything before `requestDevice()`, so the Connect button's user gesture
   * still counts.
   */
  public async connect(): Promise<void> {
    this.log("WebUSB available:", navigator.usb !== undefined);
    if (!navigator.usb) {
      throw new Error("WebUSB is not available in this browser");
    }

    // Deliberately not awaited: anything before requestDevice() would spend the
    // Connect button's user gesture and the picker would refuse to open.
    if (this.logDetails) {
      navigator.usb
        .getDevices()
        .then((devices) => {
          this.log(
            "already permitted:",
            devices.map((each) => `0x${each.vendorId.toString(16)}:0x${each.productId.toString(16)}`),
          );
        })
        .catch(() => undefined);
    }

    let device: USBDevice;
    try {
      this.log("opening picker, acceptAllDevices:", this.acceptAllDevices);
      // `acceptAllDevices` postdates @types/w3c-web-usb, hence the assertion.
      const unfiltered = { filters: [], acceptAllDevices: true } as USBDeviceRequestOptions;
      device = await navigator.usb.requestDevice(
        this.acceptAllDevices ? unfiltered : { filters: [{ vendorId: PASCO_USB_VENDOR_ID }] },
      );
    } catch (error) {
      // A NotFoundError covers both "you closed it" and "it had nothing to
      // show", which are very different during bring-up — so say so here even
      // though the source above will go quietly back to DISCONNECTED.
      this.log("picker returned no device:", error);
      if (error instanceof Error && error.name === "NotFoundError") {
        throw new DeviceSelectionCancelled();
      }
      throw error;
    }

    this.device = device;
    navigator.usb.addEventListener("disconnect", this.handleDisconnect);

    this.log("picked:", device.productName, `0x${device.vendorId.toString(16)}:0x${device.productId.toString(16)}`);
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    this.reportDescriptors(device);

    const usbInterface = device.configuration?.interfaces[0];
    if (!usbInterface) {
      throw new Error("The USB device exposes no interface to claim");
    }
    await device.claimInterface(usbInterface.interfaceNumber);
    const alternate = usbInterface.alternate;

    // Read the endpoint numbers rather than assuming them. SPARKvue hard-codes
    // 3, and a PS-3219 does use 3 for OUT — but its IN endpoint is 2, so
    // copying that constant in both directions would have been wrong.
    for (const endpoint of alternate.endpoints) {
      if (endpoint.direction === "in" && this.inEndpoint === 0) {
        this.inEndpoint = endpoint.endpointNumber;
        this.inPacketBytes = endpoint.packetSize;
      }
      if (endpoint.direction === "out" && this.outEndpoint === 0) {
        this.outEndpoint = endpoint.endpointNumber;
      }
    }
    if (this.inEndpoint === 0 || this.outEndpoint === 0) {
      throw new Error("The USB device is missing an IN or OUT endpoint");
    }

    if (this.probeOnly) {
      return;
    }
    await this.wakeBridge(device);
    await this.write(PASCO_DEVICE_SERVICE_ID, keepaliveCommand());
  }

  /**
   * Brings the bridge out of silence.
   *
   * Claiming the interface is not enough: until the `ENABLE` control transfer
   * arrives, both bulk endpoints accept writes and never answer. SPARKvue reads
   * three vendor descriptors first and tolerates failures among them — it logs
   * a transfer error on one every time and carries on — so only the enable is
   * treated as required here.
   */
  private async wakeBridge(device: USBDevice): Promise<void> {
    const read = async (request: number, value: number, index: number, length: number): Promise<string> => {
      try {
        const result = await device.controlTransferIn(
          { requestType: "vendor", recipient: "device", request: request, value: value, index: index },
          length,
        );
        if (result.status !== "ok" || !result.data) {
          return result.status;
        }
        return new TextDecoder().decode(result.data).replace(/[^\x20-\x7e]/g, ".");
      } catch (error) {
        return error instanceof Error ? error.name : String(error);
      }
    };

    this.log("bridge status:", await read(BRIDGE.STATUS, 0, 0, 2));
    this.log("bridge config:", await read(BRIDGE.CONFIG, BRIDGE.CONFIG_VALUE, BRIDGE.CONFIG_INDEX, 4));
    this.log("bridge version:", await read(BRIDGE.VERSION, 0, 0, 64));

    const enabled = await device.controlTransferOut({
      requestType: "vendor",
      recipient: "device",
      request: BRIDGE.ENABLE,
      value: 0,
      index: BRIDGE.ENABLE_INDEX,
    });
    this.log("bridge enable:", enabled.status);
    if (enabled.status !== "ok") {
      throw new Error(`USB bridge refused to start: ${enabled.status}`);
    }
  }

  /** Bring-up trace. Silent unless `?showDiagnostics=true` asked for it. */
  private log(...parts: unknown[]): void {
    if (this.logDetails) {
      // biome-ignore lint/suspicious/noConsole: Explicit hardware bring-up diagnostics.
      console.info("[MotionSensor USB]", ...parts);
    }
  }

  /**
   * Publishes what the device says about itself. Endpoint numbers, transfer
   * types and packet sizes are what decide whether the framing above can work
   * at all, and they cost nothing to read.
   */
  private reportDescriptors(device: USBDevice): void {
    const summary = {
      vendorId: `0x${device.vendorId.toString(16).padStart(4, "0")}`,
      productId: `0x${device.productId.toString(16).padStart(4, "0")}`,
      manufacturerName: device.manufacturerName,
      productName: device.productName,
      serialNumber: device.serialNumber,
      deviceClass: device.deviceClass,
      configurationValue: device.configuration?.configurationValue,
      interfaces: device.configuration?.interfaces.map((usbInterface) => ({
        interfaceNumber: usbInterface.interfaceNumber,
        claimed: usbInterface.claimed,
        interfaceClass: usbInterface.alternate.interfaceClass,
        interfaceSubclass: usbInterface.alternate.interfaceSubclass,
        interfaceProtocol: usbInterface.alternate.interfaceProtocol,
        endpoints: usbInterface.alternate.endpoints.map((endpoint) => ({
          endpointNumber: endpoint.endpointNumber,
          direction: endpoint.direction,
          type: endpoint.type,
          packetSize: endpoint.packetSize,
        })),
      })),
    };
    this.diagnosticText = JSON.stringify(summary);
    // Logged flat as well as structured: DevTools collapses a nested object
    // behind an ellipsis, and the endpoint list is the part worth reading.
    this.log("descriptors:", summary);
    this.log("descriptors (flat):", this.diagnosticText);
  }

  public async disconnect(): Promise<void> {
    // A device left on its own clock keeps ranging after the page lets go of
    // it — USB goes on powering it — so the stop has to go out before the
    // close, while there is still an endpoint to write it to.
    await this.stopStreaming();
    const device = this.device;
    navigator.usb?.removeEventListener("disconnect", this.handleDisconnect);
    this.device = null;
    this.inEndpoint = 0;
    this.outEndpoint = 0;
    this.exchanging = false;
    this.pendingIn = null;
    if (!device) {
      return;
    }
    try {
      await device.close();
    } catch {
      // The cable may already be out; the caller's state is the same either way.
    }
  }

  public async readEchoTime(): Promise<number> {
    const body = await this.exchange(MOTION_SENSOR_SERVICE_ID, readMotionSampleCommand());
    const echoTimeMicroseconds = decodeMotionNotification(body);
    if (echoTimeMicroseconds === null) {
      throw new Error("Motion sensor returned an unreadable sample packet");
    }
    return echoTimeMicroseconds;
  }

  public async setRange(range: MotionRangeValue): Promise<void> {
    await this.sendAcknowledged(AcknowledgedCommand.SET_RANGE, setRangeCommand(range), "range change");
  }

  /**
   * Puts the device on its own clock and drains what it pushes.
   *
   * Samples arrive on {@link PASCO_CHARACTERISTIC.STREAM_DATA} carrying a
   * five-bit sequence number, and stop unless the host acknowledges every
   * {@link STREAM_ACK_INTERVAL} of them on `STREAM_ACK`. Everything else on the
   * endpoint — events, stray results — is skipped.
   */
  public async startStreaming(
    periodMilliseconds: number,
    onSample: (echoTimeMicroseconds: number) => void,
  ): Promise<void> {
    if (this.deviceIsSampling) {
      return;
    }
    await this.write(MOTION_SENSOR_SERVICE_ID, setSamplePeriodCommand(periodMilliseconds * 1000));
    await this.write(PASCO_DEVICE_SERVICE_ID, startSamplingCommand(periodMilliseconds));
    this.deviceIsSampling = true;
    this.draining = true;
    this.log("streaming started at", periodMilliseconds, "ms");
    // Deliberately not awaited: the loop runs until stopStreaming, and it never
    // rejects, so there is nothing for a caller to wait on or handle.
    this.drainStream(onSample).catch(() => undefined);
  }

  /**
   * Takes the device off its own clock. Idempotent, and safe to call whatever
   * the read loop is doing: the stop is owed as long as a start went out, so it
   * is sent even when the loop has already given up. Never rejects.
   */
  public async stopStreaming(): Promise<void> {
    this.draining = false;
    if (!this.deviceIsSampling) {
      return;
    }
    this.deviceIsSampling = false;
    try {
      await this.write(PASCO_DEVICE_SERVICE_ID, stopSamplingCommand());
    } catch (error) {
      // Nothing useful to do: a device that will not hear the command is one we
      // are disconnecting from, and it is out of ideas either way.
      this.log("stop command failed:", error);
    }
  }

  /**
   * Reads until told to stop. Never rejects.
   *
   * A single bad transfer — a short frame, a stall, a read that outran its
   * deadline — is not the end of the stream: the device is on its own clock and
   * the next sample is already on its way, so the loop tolerates
   * {@link STREAM_FAILURE_TOLERANCE} in a row before giving up. Ending the loop
   * does not stop the device; only `stopStreaming` does, which is why this never
   * touches {@link deviceIsSampling}.
   */
  private async drainStream(onSample: (echoTimeMicroseconds: number) => void): Promise<void> {
    let sinceAck = 0;
    let lastSequence = 0;
    let consecutiveFailures = 0;
    while (this.draining && this.isConnected) {
      let body: Uint8Array;
      try {
        const transfer = await this.transferIn();
        if (!this.draining) {
          // Stopped while the read was in flight; a poll may own the endpoint now.
          return;
        }
        this.diagnosticText = Array.from(transfer, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
        body = usbPacketBody(transfer);
        consecutiveFailures = 0;
      } catch (error) {
        if (!this.draining) {
          return;
        }
        consecutiveFailures += 1;
        this.log(`stream read failed (${consecutiveFailures}):`, error);
        if (consecutiveFailures >= STREAM_FAILURE_TOLERANCE) {
          this.log("stream ended; the device is still sampling until stopStreaming");
          this.draining = false;
        }
        continue;
      }

      const sample = decodeStreamPacket(body);
      if (sample === null) {
        continue;
      }
      lastSequence = sample.sequence;
      onSample(sample.echoTimeMicroseconds);

      sinceAck += 1;
      if (sinceAck >= STREAM_ACK_INTERVAL) {
        sinceAck = 0;
        // Checked again because `onSample` can end the run, and an
        // acknowledgement arriving after the stop is the device's cue to keep
        // sending.
        if (!this.draining) {
          return;
        }
        try {
          await this.transferOut(
            usbWriteFrame(MOTION_SENSOR_SERVICE_ID, PASCO_CHARACTERISTIC.STREAM_ACK, streamAckCommand(lastSequence)),
          );
        } catch (error) {
          this.log("stream acknowledgement failed:", error);
          this.draining = false;
          return;
        }
      }
    }
  }

  public async setSamplePeriod(periodMicroseconds: number): Promise<void> {
    await this.sendAcknowledged(
      AcknowledgedCommand.SET_SAMPLE_PERIOD,
      setSamplePeriodCommand(periodMicroseconds),
      "sample-period change",
    );
  }

  private async sendAcknowledged(
    command: AcknowledgedCommandValue,
    packet: ArrayBuffer,
    description: string,
  ): Promise<void> {
    const body = await this.exchange(MOTION_SENSOR_SERVICE_ID, packet);
    const accepted = decodeCommandAck(body, command);
    if (accepted === null) {
      throw new Error(`Motion sensor did not answer the ${description}`);
    }
    if (!accepted) {
      throw new Error(`Motion sensor refused the ${description}`);
    }
  }

  /** Write a command, ask for the answer, and hand back the PASCO packet. */
  private async exchange(serviceId: number, packet: ArrayBuffer): Promise<Uint8Array> {
    if (this.exchanging) {
      throw new Error("A motion-sensor exchange is already in progress");
    }
    this.exchanging = true;
    try {
      await this.write(serviceId, packet);
      // No read request: SPARKvue writes the command and reads the endpoint,
      // and its captured traffic contains no `RecvData` frame anywhere. The
      // answer arrives headed `[0, RECEIVE]` — the device service, the same
      // asymmetry Bluetooth has — regardless of which service was written to.
      //
      // Events arrive on the same endpoint, unprompted and interleaved, so keep
      // reading past them until the actual answer turns up.
      const deadline = Date.now() + READ_DEADLINE_MS;
      let events = 0;
      do {
        const transfer = await this.transferIn();
        this.diagnosticText = Array.from(transfer, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
        const body = usbPacketBody(transfer);
        if (isResultPacket(body)) {
          return body;
        }
        events += 1;
      } while (Date.now() < deadline);
      throw new Error(`Motion sensor sent ${events} events and no answer`);
    } finally {
      this.exchanging = false;
    }
  }

  /**
   * One IN transfer, bounded by a deadline and with stall recovery.
   *
   * A bulk IN with nothing pending never returns — WebUSB has no timeout and no
   * way to cancel — so the deadline has to race the transfer rather than being
   * checked around it. Getting that wrong once left `exchanging` true forever
   * and failed every subsequent poll with "already in progress".
   *
   * A transfer that loses the race is not abandoned: it stays queued in the
   * browser and would swallow the next packet the device sends. Issuing a fresh
   * transfer on each call therefore left every later read one packet behind —
   * each answer consumed by a dead read, each live read timing out and leaving
   * another dead one — so a sensor ranging perfectly well looked silent forever.
   * Instead the outstanding transfer is kept in {@link pendingIn} and the next
   * call waits on it, so there is never more than one in flight.
   */
  private async transferIn(): Promise<Uint8Array> {
    const device = this.requireDevice();
    if (this.pendingIn === null) {
      const pending = device.transferIn(this.inEndpoint, this.inPacketBytes);
      this.pendingIn = pending;
      // Cleared on settling, whoever is (or is no longer) waiting on it.
      const settle = () => {
        if (this.pendingIn === pending) {
          this.pendingIn = null;
        }
      };
      pending.then(settle, settle);
    }
    const pending = this.pendingIn;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Motion sensor sent nothing in ${READ_DEADLINE_MS} ms`)),
        READ_DEADLINE_MS,
      );
    });

    try {
      const result = await Promise.race([pending, expired]);
      if (result.status === "stall") {
        // Clearing is the documented recovery, and the only alternative is to
        // keep pushing at a halted endpoint until the device drops off the bus.
        await device.clearHalt("in", this.inEndpoint);
        throw new Error("Motion sensor stalled the IN endpoint");
      }
      if (result.status !== "ok" || !result.data) {
        throw new Error(`Motion sensor read failed: ${result.status}`);
      }
      const transfer = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      if (transfer.length < MINIMUM_PACKET_BYTES) {
        throw new Error(`Motion sensor sent a ${transfer.length}-byte transfer`);
      }
      return transfer;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async write(serviceId: number, packet: ArrayBuffer): Promise<void> {
    await this.transferOut(usbWriteFrame(serviceId, PASCO_CHARACTERISTIC.SEND_COMMAND, packet));
  }

  private async transferOut(frame: ArrayBuffer): Promise<void> {
    const device = this.requireDevice();
    const result = await device.transferOut(this.outEndpoint, frame);
    if (result.status === "stall") {
      await device.clearHalt("out", this.outEndpoint);
      throw new Error("Motion sensor stalled the OUT endpoint");
    }
    if (result.status !== "ok") {
      throw new Error(`Motion sensor write failed: ${result.status}`);
    }
  }

  private requireDevice(): USBDevice {
    const device = this.device;
    if (!device?.opened) {
      throw new Error("Motion sensor is not connected");
    }
    return device;
  }
}
