/**
 * The USB streaming lifecycle.
 *
 * The rule these tests guard is that a device put on its own clock is always
 * taken off it again. The sensor keeps ranging — clicking, drawing power —
 * until STOP_SAMPLING arrives, and USB goes on powering it whatever the page
 * does, so a stop that is skipped is a stop that never happens.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsbMotionSensor } from "../../../src/sensor/model/UsbMotionSensor.js";

const START_SAMPLING = 0x06;
const STOP_SAMPLING = 0x07;
const SET_SAMPLE_PERIOD = 0x01;
const READ_ONE_SAMPLE = 0x05;

/** `[serviceId, characteristicId, opcode, ...]` — the opcode of a written frame. */
function opcodeOf(frame: Uint8Array): number | undefined {
  return frame[2];
}

/**
 * Enough of a PS-3219 to drive the client. Reads come from `inbox`; an empty
 * inbox answers a two-byte transfer, which the client rejects as too short —
 * the cheapest way to make a read fail without waiting on its deadline.
 */
class FakeUsbDevice {
  public opened = false;
  public closed = false;
  public readonly vendorId = 0x0945;
  public readonly productId = 0x8005;
  public readonly manufacturerName = "PASCO";
  public readonly productName = "Motion Sensor";
  public readonly serialNumber = "TEST";
  public readonly deviceClass = 0xff;

  /** Every frame written to the OUT endpoint, in order. */
  public readonly writes: Uint8Array[] = [];
  /** Transfers the device will answer with, oldest first. */
  public readonly inbox: Uint8Array[] = [];

  public readonly configuration = {
    configurationValue: 1,
    interfaces: [
      {
        interfaceNumber: 0,
        claimed: false,
        alternate: {
          interfaceClass: 0xff,
          interfaceSubclass: 0,
          interfaceProtocol: 0,
          endpoints: [
            { endpointNumber: 2, direction: "in", type: "bulk", packetSize: 64 },
            { endpointNumber: 3, direction: "out", type: "bulk", packetSize: 64 },
          ],
        },
      },
    ],
  };

  public open(): Promise<void> {
    this.opened = true;
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.opened = false;
    this.closed = true;
    return Promise.resolve();
  }

  public selectConfiguration(_value: number): Promise<void> {
    // The fake is already configured.
    return Promise.resolve();
  }

  public claimInterface(_interfaceNumber: number): Promise<void> {
    // Nothing to claim.
    return Promise.resolve();
  }

  public clearHalt(_direction: string, _endpoint: number): Promise<void> {
    // Nothing stalls here.
    return Promise.resolve();
  }

  public controlTransferIn(_setup: unknown, length: number): Promise<USBInTransferResult> {
    return Promise.resolve({ status: "ok", data: new DataView(new ArrayBuffer(length)) } as USBInTransferResult);
  }

  public controlTransferOut(_setup: unknown): Promise<USBOutTransferResult> {
    return Promise.resolve({ status: "ok", bytesWritten: 0 } as USBOutTransferResult);
  }

  public transferIn(_endpoint: number, _length: number): Promise<USBInTransferResult> {
    const next = this.inbox.shift() ?? new Uint8Array([0x00, 0x04]);
    return Promise.resolve({
      status: "ok",
      data: new DataView(next.buffer, next.byteOffset, next.byteLength),
    } as USBInTransferResult);
  }

  public transferOut(_endpoint: number, data: BufferSource): Promise<USBOutTransferResult> {
    this.writes.push(new Uint8Array(data as ArrayBuffer));
    return Promise.resolve({ status: "ok", bytesWritten: 0 } as USBOutTransferResult);
  }
}

/**
 * Reads the way a real browser queues them: every transfer waits until the
 * device sends something, and packets go to the oldest waiting transfer —
 * including one the client has stopped listening to.
 */
class QueuedUsbDevice extends FakeUsbDevice {
  private readonly waiting: ((result: USBInTransferResult) => void)[] = [];
  public transfersIssued = 0;

  public override transferIn(_endpoint: number, _length: number): Promise<USBInTransferResult> {
    this.transfersIssued += 1;
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  public send(packet: Uint8Array): void {
    this.waiting.shift()?.({
      status: "ok",
      data: new DataView(packet.buffer, packet.byteOffset, packet.byteLength),
    } as USBInTransferResult);
  }
}

/** `[service, STREAM_DATA, sequence, echo-low, echo-high]`. */
function streamPacket(sequence: number, echoTimeMicroseconds: number): Uint8Array {
  return new Uint8Array([0x01, 0x04, sequence, echoTimeMicroseconds & 0xff, (echoTimeMicroseconds >>> 8) & 0xff]);
}

/** Lets the un-awaited read loop run to the point where it gives up. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("UsbMotionSensor streaming", () => {
  let device: FakeUsbDevice;
  let sensor: UsbMotionSensor;

  beforeEach(async () => {
    device = new FakeUsbDevice();
    (globalThis.navigator as unknown as Record<string, unknown>)["usb"] = {
      requestDevice: () => Promise.resolve(device),
      getDevices: () => Promise.resolve([device]),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    sensor = new UsbMotionSensor(() => undefined);
    await sensor.connect();
    device.writes.length = 0;
  });

  it("starts the device's own sampler and stops it again", async () => {
    await sensor.startStreaming(50, () => undefined);
    expect(device.writes.map(opcodeOf)).toContain(SET_SAMPLE_PERIOD);
    expect(device.writes.map(opcodeOf)).toContain(START_SAMPLING);

    await sensor.stopStreaming();
    expect(device.writes.map(opcodeOf)).toContain(STOP_SAMPLING);
  });

  it("stops the device even after the read loop has given up", async () => {
    // Two good samples, then silence: an empty inbox answers transfers too
    // short to decode, and three failures in a row end the loop.
    device.inbox.push(streamPacket(0, 1000), streamPacket(1, 1100));
    const samples: number[] = [];
    await sensor.startStreaming(50, (echoTime) => samples.push(echoTime));
    await settle();
    expect(samples).toEqual([1000, 1100]);

    // The loop is gone; the device is not. The stop is still owed.
    await sensor.stopStreaming();
    expect(device.writes.map(opcodeOf)).toContain(STOP_SAMPLING);
  });

  it("sends one stop however many times it is asked", async () => {
    await sensor.startStreaming(50, () => undefined);
    await sensor.stopStreaming();
    await sensor.stopStreaming();
    expect(device.writes.map(opcodeOf).filter((opcode) => opcode === STOP_SAMPLING)).toHaveLength(1);
  });

  it("stops the device before closing the connection", async () => {
    await sensor.startStreaming(50, () => undefined);
    await sensor.disconnect();
    const stopIndex = device.writes.findIndex((frame) => opcodeOf(frame) === STOP_SAMPLING);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(device.closed).toBe(true);
  });

  it("says nothing to a device that was never streaming", async () => {
    await sensor.stopStreaming();
    expect(device.writes).toHaveLength(0);
  });
});

describe("UsbMotionSensor reads", () => {
  let device: QueuedUsbDevice;
  let sensor: UsbMotionSensor;

  beforeEach(async () => {
    device = new QueuedUsbDevice();
    (globalThis.navigator as unknown as Record<string, unknown>)["usb"] = {
      requestDevice: () => Promise.resolve(device),
      getDevices: () => Promise.resolve([device]),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    sensor = new UsbMotionSensor(() => undefined);
    await sensor.connect();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not lose the next answer to a read that timed out", async () => {
    // Nothing comes back in time: the read gives up, but the browser still
    // holds the transfer.
    const late = sensor.readEchoTime();
    const lateOutcome = expect(late).rejects.toThrow("sent nothing");
    await vi.advanceTimersByTimeAsync(600);
    await lateOutcome;

    // The next poll's answer must reach the next poll, not the dead read.
    const next = sensor.readEchoTime();
    await vi.advanceTimersByTimeAsync(0);
    device.send(new Uint8Array([0xc0, 0x00, READ_ONE_SAMPLE, 0xe8, 0x03]));
    await expect(next).resolves.toBe(1000);
    expect(device.transfersIssued).toBe(1);
  });
});
