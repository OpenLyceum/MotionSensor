/** Dependency-free PASCO wire protocol, scoped to the PS-3219 motion sensor. */

const UUID_PREFIX = "4a5c000";
const UUID_SUFFIX = "5c1e741f1c00";

export const PASCO_CHARACTERISTIC = {
  SERVICE: 0,
  SEND_COMMAND: 2,
  RECEIVE: 3,
  /** Where the device pushes samples once it is sampling on its own clock. */
  STREAM_DATA: 4,
  /** Where the host acknowledges them, or the device stops sending. */
  STREAM_ACK: 5,
} as const;

export const PASCO_DEVICE_SERVICE_ID = 0;
export const MOTION_SENSOR_SERVICE_ID = 1;
export const MOTION_SENSOR_SAMPLE_BYTES = 2;
export const MOTION_SENSOR_ADVERTISED_NAME = "Motion";
export const SPEED_OF_SOUND_MPS = 344;

const READ_ONE_SAMPLE = 0x05;

/**
 * Selects a sensor's measurement range. Absent from PASCO's own libraries;
 * recovered from `PascoBLEDriver::SetRange` in SPARKvue's WebAssembly build,
 * which frames it as `[SET_RANGE, 0x00, ordinal, index]` and waits a second for
 * the ordinary result packet. See doc/implementation-notes.md.
 */
const SET_RANGE = 0x28;

/**
 * Sets the period of the device's own periodic sampler, as a little-endian
 * microsecond count. `BLEInterface::PreStartSampling` scales seconds by 1e6
 * before calling it. Note this configures streaming only — {@link READ_ONE_SAMPLE}
 * is unaffected, so on its own the command changes nothing this sim reads.
 */
const SET_SAMPLE_PERIOD = 0x01;

/**
 * Starts and stops the device's own sampler. `START_SAMPLING` carries one
 * little-endian millisecond period per channel and goes to the device service,
 * not a sensor's — `BLEInterface::StartSampling` scales seconds by 1000 and
 * masks to eleven bits before sending it.
 */
const START_SAMPLING = 0x06;
const STOP_SAMPLING = 0x07;

/** Sequence numbers on streamed packets are five bits and wrap. */
const STREAM_SEQUENCE_MODULUS = 0x20;

/**
 * Streamed packets are acknowledged in batches; `pasco_python` sends one every
 * time its counter passes eight, and captured USB traffic acknowledges at
 * sequence 0x1f and again at 0x07 — eight apart both times.
 */
export const STREAM_ACK_INTERVAL = 8;

/**
 * Which of the sensor's ranged measurements to address, counting only those the
 * datasheet flags `IsRange="1"`. The PS-3219 declares exactly one — measurement
 * 100, `MotionRange` — so this is always zero here.
 */
const RANGE_MEASUREMENT_ORDINAL = 0x00;

const RESULT = 0xc0;
const STATUS_OK = 0x00;

/**
 * The PS-3219's two receiver ranges, as the one-based indices {@link SET_RANGE}
 * takes. Short raises the receiver's gain for nearby targets; long trades that
 * away for distant echoes. The datasheet spells them `MotionShort:1:MotionLong:2`
 * and the device powers up on long.
 */
export const MotionRange = {
  SHORT: 1,
  LONG: 2,
} as const;

export type MotionRangeValue = (typeof MotionRange)[keyof typeof MotionRange];

export function pascoUuid(serviceId: number, characteristicId: number): string {
  return `${UUID_PREFIX}${serviceId}-000${characteristicId}-0000-0000-${UUID_SUFFIX}`;
}

export const MOTION_SENSOR_OPTIONAL_SERVICE_UUIDS: readonly string[] = [
  PASCO_DEVICE_SERVICE_ID,
  MOTION_SENSOR_SERVICE_ID,
].map((serviceId) => pascoUuid(serviceId, PASCO_CHARACTERISTIC.SERVICE));

export function toCommandBuffer(bytes: readonly number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** Device-service keepalive sent after subscribing to notifications. */
export function keepaliveCommand(): ArrayBuffer {
  return toCommandBuffer([0x00]);
}

/** Channel 0 has one two-byte raw field: ultrasonic round-trip echo time. */
export function readMotionSampleCommand(): ArrayBuffer {
  return toCommandBuffer([READ_ONE_SAMPLE, MOTION_SENSOR_SAMPLE_BYTES]);
}

/** Asks the sensor to switch receiver range. Answered like any other command. */
export function setRangeCommand(range: MotionRangeValue): ArrayBuffer {
  return toCommandBuffer([SET_RANGE, 0x00, RANGE_MEASUREMENT_ORDINAL, range]);
}

/** Opcodes this client sends and then waits to see acknowledged. */
export const AcknowledgedCommand = {
  SET_SAMPLE_PERIOD,
  SET_RANGE,
} as const;

export type AcknowledgedCommandValue = (typeof AcknowledgedCommand)[keyof typeof AcknowledgedCommand];

/** Asks the sensor to reconfigure its periodic sampler. Trailing bytes are reserved. */
export function setSamplePeriodCommand(periodMicroseconds: number): ArrayBuffer {
  const period = Math.round(periodMicroseconds);
  return toCommandBuffer([
    SET_SAMPLE_PERIOD,
    period & 0xff,
    (period >>> 8) & 0xff,
    (period >>> 16) & 0xff,
    (period >>> 24) & 0xff,
    0x00,
    0x00,
  ]);
}

/**
 * Decode [result, status, opcode]. `null` when the packet answers some other
 * command, `false` when the device answered but refused this one.
 */
export function decodeCommandAck(data: Uint8Array, command: AcknowledgedCommandValue): boolean | null {
  if (data.length < 3 || data[0] !== RESULT || data[2] !== command) {
    return null;
  }
  return data[1] === STATUS_OK;
}

/** Starts the device sampling on its own clock, one channel, period in ms. */
export function startSamplingCommand(periodMilliseconds: number): ArrayBuffer {
  const period = Math.round(periodMilliseconds) & 0x7ff;
  return toCommandBuffer([START_SAMPLING, period & 0xff, (period >>> 8) & 0xff]);
}

export function stopSamplingCommand(): ArrayBuffer {
  return toCommandBuffer([STOP_SAMPLING]);
}

/**
 * A streamed sample: `[sequence, echo-low, echo-high]`, sequence below
 * {@link STREAM_SEQUENCE_MODULUS}. Anything else — a result, an event — is not
 * one of these, and `null` says so.
 */
export function decodeStreamPacket(packet: Uint8Array): { sequence: number; echoTimeMicroseconds: number } | null {
  if (packet.length < 1 + MOTION_SENSOR_SAMPLE_BYTES || packet[0] === undefined) {
    return null;
  }
  const sequence = packet[0];
  if (sequence >= STREAM_SEQUENCE_MODULUS) {
    return null;
  }
  return {
    sequence: sequence,
    echoTimeMicroseconds: (packet[1] ?? 0) | ((packet[2] ?? 0) << 8),
  };
}

/** `[0, 0, 0, 0, sequence]` — acknowledges everything up to that sequence. */
export function streamAckCommand(lastSequence: number): ArrayBuffer {
  return toCommandBuffer([0x00, 0x00, 0x00, 0x00, lastSequence & (STREAM_SEQUENCE_MODULUS - 1)]);
}

/**
 * True when a packet answers a command, rather than being one of the events the
 * device emits unprompted — `85 96 0f 62 00 04` and the like, which interleave
 * with responses and must be skipped rather than mistaken for one.
 */
export function isResultPacket(packet: Uint8Array): boolean {
  return packet.length >= 3 && packet[0] === RESULT;
}

/** Decode [result, ok, read-one, echo-low, echo-high]. */
export function decodeMotionNotification(data: Uint8Array): number | null {
  if (
    data.length < 3 + MOTION_SENSOR_SAMPLE_BYTES ||
    data[0] !== RESULT ||
    data[1] !== STATUS_OK ||
    data[2] !== READ_ONE_SAMPLE
  ) {
    return null;
  }
  return (data[3] ?? 0) | ((data[4] ?? 0) << 8);
}

// ── USB envelope ──────────────────────────────────────────────────────────────
//
// Over USB the packets above are unchanged; they simply gain a two-byte header
// naming the service and characteristic that GATT would have addressed, and a
// read becomes an explicit request rather than a subscription. Recovered from
// `USBBLEDevice::SendData` / `::RecvData`.

// `USBBLEDevice::RecvData` can build a `[service | 0x80, characteristic, count]`
// read request, but captured SPARKvue traffic contains none: a command is
// written and the IN endpoint is simply read. No such frame is built here.

/** One transfer cannot exceed 64 bytes, two of which are the header. */
export const USB_MAXIMUM_PAYLOAD_BYTES = 62;

/** `[service, characteristic, ...packet]` — a write to that characteristic. */
export function usbWriteFrame(serviceId: number, characteristicId: number, packet: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(packet);
  return toCommandBuffer([serviceId, characteristicId, ...bytes.subarray(0, USB_MAXIMUM_PAYLOAD_BYTES)]);
}

/**
 * Strips the two-byte header from a USB IN transfer. `USBBLEDevice::run`
 * rebuilds its handle as `(buf[0] << 8) | buf[1]`, so the header is always
 * there — but a transfer that already starts with a result byte is passed
 * through rather than truncated, because misreading one costs a whole sample.
 */
export function usbPacketBody(transfer: Uint8Array): Uint8Array {
  if (transfer.length >= 3 && transfer[0] === RESULT) {
    return transfer;
  }
  return transfer.subarray(2);
}

export function echoTimeToMetres(echoTimeMicroseconds: number): number {
  return (echoTimeMicroseconds / 1_000_000) * SPEED_OF_SOUND_MPS * 0.5;
}
