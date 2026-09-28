/**
 * SensorPositionSource.ts
 *
 * The Motion Sensor screen's source: a PASCO Wireless Motion Sensor (PS-3219)
 * reached directly over Web Bluetooth or WebUSB using its small PASCO wire
 * protocol.
 *
 * ── Either transport, polled or streamed ──────────────────────────────────────
 * Web Bluetooth and WebUSB carry the same PASCO packets, so `connect()` takes
 * the transport as an argument and everything below this class is shared.
 * Sampling begins only when a recording starts and stops when it ends,
 * silencing the ultrasonic transducer in between while leaving the connection
 * ready. One `readEchoTime` is one round trip; where the transport can carry a
 * stream the device keeps time itself instead and pushes samples — see
 * `startSampling`.
 *
 * ── What the device measures, and what this publishes ─────────────────────────
 * The device answers with an echo time, and nothing else. Everything a student
 * can change about the reading is applied here, on the host, in one place and in
 * one order:
 *
 *   echo time ─▶ distance ─▶ range gate ─▶ − zero offset ─▶ × sign ─▶ published
 *
 * That is the same set of adjustments PASCO's own software offers (Change Sign,
 * Zero Sensor Now, Zero at Start, Range), and it is applied in the same order:
 * an offset captured with the sign flipped still zeroes where the student stood.
 * Diagnostics deliberately report the *raw* distance, before any of it — that is
 * the number that tells you whether the hardware is answering.
 *
 * ── Errors never reach the caller ─────────────────────────────────────────────
 * `connect()` resolves even when it fails. Connection outcomes are UI state, not
 * exceptions: the button listener stays synchronous (so the browser still sees a
 * user gesture), and every outcome lands on `connectionStateProperty` /
 * `errorMessageProperty` where the panel can render it. A cancelled device
 * picker is not a failure — it returns to DISCONNECTED with no message.
 */

import { BooleanProperty, NumberProperty, Property, type TReadOnlyProperty } from "scenerystack/axon";
import {
  DEFAULT_POLL_INTERVAL_MS,
  MAXIMUM_CONSECUTIVE_FAILURES,
  POSITION_MEASUREMENT,
  SENSOR_REPORTED_RANGE_M,
} from "../../MotionSensorConstants.js";
import MotionSensorNamespace from "../../MotionSensorNamespace.js";
import { BluetoothMotionSensor } from "../../sensor/model/BluetoothMotionSensor.js";
import { DeviceSelectionCancelled, type TMotionSensorDevice } from "../../sensor/model/MotionSensorDevice.js";
import { echoTimeToMetres } from "../../sensor/model/PascoMotionProtocol.js";
import { UsbMotionSensor } from "../../sensor/model/UsbMotionSensor.js";
import { ConnectionState, type ConnectionStateValue } from "./ConnectionState.js";
import { PositionSourceType, type PositionSourceTypeValue, type TPositionSource } from "./PositionSource.js";
import { SensorRange, type SensorRangeValue } from "./SensorRange.js";
import { adjustReading, isEchoInRange } from "./sensorMeasurement.js";

/** The two ways a PS-3219 can be reached from a browser. */
export const SensorTransport = {
  BLUETOOTH: "bluetooth",
  USB: "usb",
} as const;

export type SensorTransportValue = (typeof SensorTransport)[keyof typeof SensorTransport];

/**
 * How long a stream may say nothing before the recording gives up on it and
 * polls instead. Long enough to cover a slow first sample, short enough that a
 * short recording still gets a trace.
 */
const STREAM_SILENCE_TIMEOUT_MS = 1000;

export type SensorPositionSourceOptions = {
  /**
   * Sample period in milliseconds — the poll period, or the period the device
   * is asked to keep when it is streaming. Overridable from a query parameter.
   */
  readonly pollIntervalMs?: number;
  /**
   * Let a transport that can carry a stream put the device on its own clock.
   * False polls everywhere; transports without a stream poll regardless.
   */
  readonly streamingEnabled?: boolean;
  /** USB bring-up switches; ignored on Bluetooth. */
  readonly usbProbeOnly?: boolean;
  readonly usbAcceptAllDevices?: boolean;
  /**
   * When true, publishes the raw echo time and calculated position.
   */
  readonly diagnosticsEnabledProperty?: TReadOnlyProperty<boolean>;
};

export class SensorPositionSource implements TPositionSource {
  public readonly sourceType: PositionSourceTypeValue = PositionSourceType.MOTION_SENSOR;

  /** Where the sensor last saw the student, in metres, after the adjustments below. */
  public readonly sensorPositionProperty: NumberProperty;

  /**
   * Which echoes to believe. See {@link SensorRange}: on the device this is a
   * gain ramp, here it is an acceptance window.
   */
  public readonly rangeProperty: Property<SensorRangeValue>;

  /**
   * Negates the reading, so walking away from the sensor reads as *decreasing*
   * position. What the cart-and-track convention wants when the origin is at the
   * far end of the track.
   */
  public readonly changeSignProperty: BooleanProperty;

  /**
   * When true, the first reading of each run becomes the new zero, so a student
   * can stand where they like and record displacement from there.
   */
  public readonly zeroAtStartProperty: BooleanProperty;

  /** Distance subtracted from every reading, in metres. Zero until one is captured. */
  public readonly zeroOffsetProperty: NumberProperty;

  public readonly connectionStateProperty: Property<ConnectionStateValue>;

  /** Human-readable failure text, or null when nothing has gone wrong. */
  public readonly errorMessageProperty: Property<string | null>;

  /** Advertised name of the connected device, or null. */
  public readonly deviceNameProperty: Property<string | null>;

  /**
   * What the device says it can measure, captured at connect time. Empty until
   * connected. Shown only with diagnostics on — if this is empty on a connected
   * device, the datasheet lookup failed and no reading will ever arrive.
   */
  public readonly measurementListProperty: Property<string>;

  /**
   * The last raw reading, formatted for display, including the distinction
   * between a null (no answer) and a 0 (an answer of zero — usually nothing
   * within the sensor's 0.15–4 m range to echo off).
   */
  public readonly diagnosticsProperty: Property<string>;

  private readonly availableProperty: BooleanProperty;

  private readonly pollIntervalMs: number;
  private readonly streamingEnabled: boolean;
  private readonly usbProbeOnly: boolean;
  private readonly usbAcceptAllDevices: boolean;
  private readonly diagnosticsEnabledProperty: TReadOnlyProperty<boolean> | null;
  private readonly handleUnexpectedDisconnect: () => void;
  private readonly republishAdjusted: () => void;

  private device: TMotionSensorDevice | null = null;

  /** Last distance the device actually reported, before any adjustment. Null before the first one. */
  private lastRawDistanceM: number | null = null;

  /** Set by {@link startSampling} when zero-at-start is on; the next accepted reading consumes it. */
  private zeroOnNextReading = false;

  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;
  private isStreaming = false;
  /** Whether a recording has asked for readings, whichever mechanism is serving it. */
  private samplingRequested = false;
  private streamWatchdogId: ReturnType<typeof setTimeout> | null = null;
  private samplesSinceStreamStart = 0;
  /** Invalidates an asynchronous read if sampling stops while it is in flight. */
  private pollingGeneration = 0;
  private consecutiveFailures = 0;
  private diagnosticsStartTimeMs = 0;

  public constructor(providedOptions?: SensorPositionSourceOptions) {
    this.pollIntervalMs = providedOptions?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.streamingEnabled = providedOptions?.streamingEnabled !== false;
    this.usbProbeOnly = providedOptions?.usbProbeOnly === true;
    this.usbAcceptAllDevices = providedOptions?.usbAcceptAllDevices === true;
    this.diagnosticsEnabledProperty = providedOptions?.diagnosticsEnabledProperty ?? null;

    // The published value can be negative (sign flipped) or beyond the track
    // (zeroed from the far end), so its range is the sensor's reach either way
    // round rather than the track's 0-2 m. The view keeps the walker on the
    // track; the graph scales to whatever was recorded.
    this.sensorPositionProperty = new NumberProperty(0, { range: SENSOR_REPORTED_RANGE_M, units: "m" });
    this.rangeProperty = new Property<SensorRangeValue>(SensorRange.LONG);
    this.changeSignProperty = new BooleanProperty(false);
    this.zeroAtStartProperty = new BooleanProperty(false);
    this.zeroOffsetProperty = new NumberProperty(0, { units: "m" });
    this.connectionStateProperty = new Property<ConnectionStateValue>(ConnectionState.DISCONNECTED);
    this.errorMessageProperty = new Property<string | null>(null);
    this.deviceNameProperty = new Property<string | null>(null);
    this.availableProperty = new BooleanProperty(false);
    this.measurementListProperty = new Property<string>("");
    this.diagnosticsProperty = new Property<string>("");
    // An adjustment changes what the last reading *means*, so republish it at
    // once rather than leaving a stale number on screen until the next poll —
    // and polling only runs during a recording, so there may not be a next one.
    this.republishAdjusted = () => {
      if (this.lastRawDistanceM !== null) {
        this.publishDistance(this.lastRawDistanceM);
      }
    };
    this.changeSignProperty.lazyLink(this.republishAdjusted);
    this.zeroOffsetProperty.lazyLink(this.republishAdjusted);

    this.handleUnexpectedDisconnect = () => {
      this.stopSampling();
      this.availableProperty.value = false;
      this.deviceNameProperty.value = null;
      this.connectionStateProperty.value = ConnectionState.ERROR;
      this.errorMessageProperty.value = "disconnected";
    };
  }

  public get positionProperty(): TReadOnlyProperty<number> {
    return this.sensorPositionProperty;
  }

  public get isAvailableProperty(): TReadOnlyProperty<boolean> {
    return this.availableProperty;
  }

  /**
   * Opens the browser's device picker for the given transport and connects.
   * Never rejects.
   *
   * The transport is an argument rather than a constructor option because the
   * panel offers both and the student picks one at the moment of connecting.
   * The device picker is invoked before the first await so the browser still
   * recognizes the Connect button's user gesture.
   */
  public async connect(transport: SensorTransportValue = SensorTransport.BLUETOOTH): Promise<void> {
    if (this.connectionStateProperty.value === ConnectionState.CONNECTING) {
      return;
    }

    this.connectionStateProperty.value = ConnectionState.CONNECTING;
    this.errorMessageProperty.value = null;

    const device: TMotionSensorDevice =
      transport === SensorTransport.USB
        ? new UsbMotionSensor(this.handleUnexpectedDisconnect, {
            probeOnly: this.usbProbeOnly,
            acceptAllDevices: this.usbAcceptAllDevices,
            logDetails: this.diagnosticsEnabledProperty?.value === true,
          })
        : new BluetoothMotionSensor(this.handleUnexpectedDisconnect);
    this.device = device;

    try {
      await device.connect();
    } catch (error) {
      await device.disconnect();
      this.device = null;
      if (error instanceof DeviceSelectionCancelled) {
        this.connectionStateProperty.value = ConnectionState.DISCONNECTED;
        return;
      }
      this.connectionStateProperty.value = ConnectionState.ERROR;
      this.errorMessageProperty.value = error instanceof Error ? error.message : String(error);
      return;
    }

    this.deviceNameProperty.value = device.name;
    this.measurementListProperty.value = POSITION_MEASUREMENT;
    this.connectionStateProperty.value = ConnectionState.CONNECTED;
    this.availableProperty.value = true;
    this.consecutiveFailures = 0;
    this.diagnosticsStartTimeMs = performance.now();

    if (this.usbProbeOnly) {
      // The whole point of a probe is that the device is left untouched.
      this.diagnosticsProperty.value = device.diagnosticText ?? "probe complete";
    }
  }

  /** Tears the link down deliberately. Never rejects. */
  public async disconnect(): Promise<void> {
    this.stopSampling();
    try {
      await this.device?.disconnect();
    } catch {
      // A disconnect that fails leaves nothing useful to say or do; the state
      // below is what the student sees either way.
    }
    this.availableProperty.value = false;
    this.deviceNameProperty.value = null;
    this.lastRawDistanceM = null;
    this.measurementListProperty.value = "";
    this.diagnosticsProperty.value = "";
    this.errorMessageProperty.value = null;
    this.connectionStateProperty.value = ConnectionState.DISCONNECTED;
  }

  public startSampling(): void {
    if (this.samplingRequested || this.usbProbeOnly) {
      return;
    }
    this.samplingRequested = true;
    // Zero-at-start is armed rather than applied: the offset is whatever the
    // *first accepted reading* of this run turns out to be, which is where the
    // student was standing when they pressed Record.
    this.zeroOnNextReading = this.zeroAtStartProperty.value;
    this.diagnosticsStartTimeMs = performance.now();

    // Streaming lets the device keep time, which removes the round-trip jitter
    // a poll cannot avoid. It needs a transport that can carry the stream;
    // anything else polls, which always works.
    const device = this.device;
    if (this.streamingEnabled && device?.startStreaming) {
      this.isStreaming = true;
      this.samplesSinceStreamStart = 0;
      // A device can accept the start command and then push nothing — the one
      // failure a stream cannot report, because there is no round trip left to
      // fail. Without this the recording would be flat and say why nowhere, so
      // silence is given a deadline and answered by polling.
      this.streamWatchdogId = setTimeout(() => {
        this.streamWatchdogId = null;
        if (this.samplingRequested && this.isStreaming && this.samplesSinceStreamStart === 0) {
          this.diagnosticsProperty.value = "stream silent; polling instead";
          this.isStreaming = false;
          device.stopStreaming?.().catch(() => undefined);
          this.startPolling();
        }
      }, STREAM_SILENCE_TIMEOUT_MS);
      device
        .startStreaming(this.pollIntervalMs, (echoTimeMicroseconds) => {
          this.acceptReading(echoTimeMicroseconds);
        })
        .catch((error: unknown) => {
          // A device that will not stream still answers single reads, so the
          // recording carries on polling rather than recording nothing at all.
          // Unless it ended while the refusal was in flight, in which case the
          // request is gone and starting a timer now would outlive it.
          this.isStreaming = false;
          this.diagnosticsProperty.value = `streaming refused: ${error instanceof Error ? error.message : error}`;
          if (this.samplingRequested) {
            this.startPolling();
          }
        });
      return;
    }

    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollTimerId !== null) {
      return;
    }
    const generation = ++this.pollingGeneration;
    this.poll(generation).catch(() => undefined);
    this.pollTimerId = setInterval(() => {
      this.poll(generation).catch(() => undefined);
    }, this.pollIntervalMs);
  }

  public stopSampling(): void {
    this.samplingRequested = false;
    this.pollingGeneration += 1;
    this.zeroOnNextReading = false;
    if (this.streamWatchdogId !== null) {
      clearTimeout(this.streamWatchdogId);
      this.streamWatchdogId = null;
    }
    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
    this.isPolling = false;
    this.isStreaming = false;
    // Asked for unconditionally, not just when this class believes it is
    // streaming. A streaming device keeps its own clock: if the stop is missed
    // it goes on ranging for as long as it has power, which is the one failure
    // here that outlives the recording. `stopStreaming` knows whether it is owed.
    this.device?.stopStreaming?.().catch(() => undefined);
  }

  /**
   * One reading. Skipping a tick because the previous round trip has not
   * returned is harmless — the model samples the latest value, so a late
   * reading costs at most one stale sample rather than corrupting the trace.
   */
  private async poll(generation: number): Promise<void> {
    const device = this.device;
    if (this.isPolling || device === null || !device.isConnected) {
      return;
    }
    this.isPolling = true;

    try {
      const echoTimeMicroseconds = await device.readEchoTime();
      if (generation !== this.pollingGeneration) {
        return;
      }
      this.acceptReading(echoTimeMicroseconds);
    } catch (error) {
      if (generation !== this.pollingGeneration) {
        return;
      }
      this.consecutiveFailures += 1;
      if (this.diagnosticsEnabledProperty?.value === true) {
        // biome-ignore lint/suspicious/noConsole: Explicit hardware bring-up diagnostics.
        console.warn("[MotionSensor sensor] read failed", error, device.diagnosticText ?? "");
      }
      if (this.consecutiveFailures >= MAXIMUM_CONSECUTIVE_FAILURES) {
        this.stopSampling();
        this.availableProperty.value = false;
        this.connectionStateProperty.value = ConnectionState.ERROR;
        this.errorMessageProperty.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.isPolling = false;
    }
  }

  /** One reading, however it arrived — polled round trip or pushed by the device. */
  private acceptReading(echoTimeMicroseconds: number): void {
    const metres = echoTimeToMetres(echoTimeMicroseconds);
    this.diagnosticsProperty.value = `${POSITION_MEASUREMENT}=${metres}`;

    if (this.diagnosticsEnabledProperty?.value === true) {
      const elapsedSeconds = (performance.now() - this.diagnosticsStartTimeMs) / 1000;
      // biome-ignore lint/suspicious/noConsole: Explicit hardware bring-up diagnostics.
      console.info(`[MotionSensor sensor +${elapsedSeconds.toFixed(3)} s]`, {
        EchoTimeMicroseconds: echoTimeMicroseconds,
        Position: metres,
        ...(this.device?.diagnosticText ? { RawTransfer: this.device.diagnosticText } : {}),
      });
    }

    this.consecutiveFailures = 0;
    this.samplesSinceStreamStart += 1;
    this.publishDistance(metres);
  }

  /**
   * Takes the current reading as the new zero. Never rejects.
   *
   * While a recording is running the poll loop or the stream owns the link — a
   * second read would collide with it — so the most recent reading is used.
   * Otherwise nothing is being read at all, and this asks the device for one
   * sample of its own, which is what makes the button useful while idle.
   */
  public async zeroNow(): Promise<void> {
    // A probed device is left alone, and a recording already owns the link.
    const linkIsFree = !(this.samplingRequested || this.usbProbeOnly);
    const device = this.device;
    if (linkIsFree && device?.isConnected) {
      try {
        const echoTimeMicroseconds = await device.readEchoTime();
        const metres = echoTimeToMetres(echoTimeMicroseconds);
        if (isEchoInRange(metres, this.rangeProperty.value)) {
          this.lastRawDistanceM = metres;
        }
      } catch {
        // A failed one-shot read falls back to the last reading below; there is
        // nothing for a student to do about it that retrying will not fix.
      }
    }
    if (this.lastRawDistanceM !== null) {
      this.zeroOffsetProperty.value = this.lastRawDistanceM;
    }
  }

  /** Returns to raw distances from the sensor's own face. */
  public removeZeroOffset(): void {
    this.zeroOffsetProperty.value = 0;
  }

  /**
   * Applies the range gate and the student's adjustments to one raw distance and
   * publishes the result.
   *
   * A reading outside the range is *dropped*, not clamped: it is an echo off
   * something that is not the target, and holding the previous position is less
   * of a lie than pinning the walker to the end of the track.
   */
  private publishDistance(metres: number): void {
    if (!isEchoInRange(metres, this.rangeProperty.value)) {
      return;
    }
    this.lastRawDistanceM = metres;
    if (this.zeroOnNextReading) {
      this.zeroOnNextReading = false;
      this.zeroOffsetProperty.value = metres;
    }
    const adjusted = adjustReading(metres, {
      zeroOffsetM: this.zeroOffsetProperty.value,
      changeSign: this.changeSignProperty.value,
    });
    this.sensorPositionProperty.value = SENSOR_REPORTED_RANGE_M.constrainValue(adjusted);
  }

  /**
   * No-op. The sensor ranges on its own clock, so a paused or backgrounded sim
   * must not be mistaken for a stationary student.
   */
  public step(_dt: number): void {
    // intentionally empty
  }

  /** Returns to the pre-run state without dropping the connection. */
  public reset(): void {
    this.stopSampling();
    this.sensorPositionProperty.reset();
    this.rangeProperty.reset();
    this.changeSignProperty.reset();
    this.zeroAtStartProperty.reset();
    this.zeroOffsetProperty.reset();
    this.lastRawDistanceM = null;
  }

  public dispose(): void {
    this.stopSampling();
    if (this.device !== null) {
      // Fire-and-forget: dispose cannot await, and a failed teardown of a link
      // that is going away anyway has nothing useful to report.
      this.device.disconnect().catch(() => undefined);
      this.device = null;
    }
    this.changeSignProperty.unlink(this.republishAdjusted);
    this.zeroOffsetProperty.unlink(this.republishAdjusted);
    this.sensorPositionProperty.dispose();
    this.rangeProperty.dispose();
    this.changeSignProperty.dispose();
    this.zeroAtStartProperty.dispose();
    this.zeroOffsetProperty.dispose();
    this.connectionStateProperty.dispose();
    this.errorMessageProperty.dispose();
    this.deviceNameProperty.dispose();
    this.measurementListProperty.dispose();
    this.diagnosticsProperty.dispose();
    this.availableProperty.dispose();
  }
}

MotionSensorNamespace.register("SensorPositionSource", SensorPositionSource);
