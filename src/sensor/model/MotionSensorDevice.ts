/**
 * MotionSensorDevice.ts
 *
 * What `MotionSensorSource` needs from a PS-3219, independent of how it is
 * reached. Web Bluetooth and WebUSB carry the same PASCO packets — see
 * doc/implementation-notes.md — so the difference stops at this interface and
 * never reaches the model or the view.
 */

import type { MotionRangeValue } from "./PascoMotionProtocol.js";

/** Thrown when the user dismisses the browser's device picker. Not a failure. */
export class DeviceSelectionCancelled extends Error {}

export interface TMotionSensorDevice {
  readonly isConnected: boolean;

  /** Advertised name, or null before a connection exists. */
  readonly name: string | null;

  /**
   * Transport-specific detail for `?showDiagnostics=true`, or undefined when
   * the transport has nothing to add beyond the decoded reading.
   */
  readonly diagnosticText?: string;

  /** Opens the picker and connects. Must reach the picker before any `await`. */
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  /** One ultrasonic round trip, in microseconds. */
  readEchoTime(): Promise<number>;

  setRange(range: MotionRangeValue): Promise<void>;

  /** Reconfigures the device's periodic sampler. Does not affect single reads. */
  setSamplePeriod(periodMicroseconds: number): Promise<void>;

  /**
   * Puts the device on its own clock, calling back with each sample it pushes,
   * so the host stops paying a round trip per reading. Present only on
   * transports that can carry the stream; callers fall back to `readEchoTime`.
   */
  startStreaming?(periodMilliseconds: number, onSample: (echoTimeMicroseconds: number) => void): Promise<void>;

  stopStreaming?(): Promise<void>;
}
