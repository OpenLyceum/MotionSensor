import { describe, expect, it } from "vitest";
import {
  AcknowledgedCommand,
  decodeCommandAck,
  decodeMotionNotification,
  decodeStreamPacket,
  echoTimeToMetres,
  isResultPacket,
  MOTION_SENSOR_OPTIONAL_SERVICE_UUIDS,
  MOTION_SENSOR_SERVICE_ID,
  MotionRange,
  PASCO_CHARACTERISTIC,
  pascoUuid,
  readMotionSampleCommand,
  STREAM_ACK_INTERVAL,
  setRangeCommand,
  setSamplePeriodCommand,
  startSamplingCommand,
  stopSamplingCommand,
  streamAckCommand,
  usbPacketBody,
  usbWriteFrame,
} from "../../../src/sensor/model/PascoMotionProtocol.js";

const bytes = (buffer: ArrayBuffer): number[] => Array.from(new Uint8Array(buffer));

describe("PASCO motion-sensor protocol", () => {
  it("builds device and sensor GATT UUIDs", () => {
    expect(pascoUuid(0, 3)).toBe("4a5c0000-0003-0000-0000-5c1e741f1c00");
    expect(pascoUuid(1, 2)).toBe("4a5c0001-0002-0000-0000-5c1e741f1c00");
    expect(MOTION_SENSOR_OPTIONAL_SERVICE_UUIDS).toHaveLength(2);
  });

  it("requests the PS-3219 two-byte sample", () => {
    expect(Array.from(new Uint8Array(readMotionSampleCommand()))).toEqual([0x05, 0x02]);
  });

  it("decodes a successful service-0 response little-endian", () => {
    expect(decodeMotionNotification(new Uint8Array([0xc0, 0x00, 0x05, 0x88, 0x13]))).toBe(5000);
  });

  it("rejects unrelated, failed, and short notifications", () => {
    expect(decodeMotionNotification(new Uint8Array([0x03, 0x88, 0x13]))).toBeNull();
    expect(decodeMotionNotification(new Uint8Array([0xc0, 0x01, 0x05, 0x88, 0x13]))).toBeNull();
    expect(decodeMotionNotification(new Uint8Array([0xc0, 0x00, 0x05, 0x88]))).toBeNull();
  });

  it("addresses the sensor's one ranged measurement, one-based", () => {
    expect(bytes(setRangeCommand(MotionRange.SHORT))).toEqual([0x28, 0x00, 0x00, 0x01]);
    expect(bytes(setRangeCommand(MotionRange.LONG))).toEqual([0x28, 0x00, 0x00, 0x02]);
  });

  it("separates an accepted command from a refused one", () => {
    expect(decodeCommandAck(new Uint8Array([0xc0, 0x00, 0x28]), AcknowledgedCommand.SET_RANGE)).toBe(true);
    expect(decodeCommandAck(new Uint8Array([0xc0, 0x01, 0x28]), AcknowledgedCommand.SET_RANGE)).toBe(false);
  });

  it("ignores packets that answer a different command", () => {
    const sample = new Uint8Array([0xc0, 0x00, 0x05, 0x88, 0x13]);
    expect(decodeCommandAck(sample, AcknowledgedCommand.SET_RANGE)).toBeNull();
    expect(decodeCommandAck(new Uint8Array([0x03, 0x00, 0x28]), AcknowledgedCommand.SET_RANGE)).toBeNull();
    expect(decodeCommandAck(new Uint8Array([0xc0, 0x00]), AcknowledgedCommand.SET_RANGE)).toBeNull();
    // A range acknowledgement must not satisfy a pending sample-period wait.
    expect(decodeCommandAck(new Uint8Array([0xc0, 0x00, 0x28]), AcknowledgedCommand.SET_SAMPLE_PERIOD)).toBeNull();
    expect(decodeMotionNotification(sample)).toBe(5000);
  });

  it("encodes the sample period as little-endian microseconds", () => {
    // 20 Hz is 50 ms is 50000 us is 0x0000c350.
    expect(bytes(setSamplePeriodCommand(50_000))).toEqual([0x01, 0x50, 0xc3, 0x00, 0x00, 0x00, 0x00]);
    // 250 Hz, the datasheet's MaxRate, is 4000 us.
    expect(bytes(setSamplePeriodCommand(4_000))).toEqual([0x01, 0xa0, 0x0f, 0x00, 0x00, 0x00, 0x00]);
  });

  it("wraps packets in the USB service/characteristic header", () => {
    expect(
      bytes(usbWriteFrame(MOTION_SENSOR_SERVICE_ID, PASCO_CHARACTERISTIC.SEND_COMMAND, readMotionSampleCommand())),
    ).toEqual([0x01, 0x02, 0x05, 0x02]);
  });

  it("reads a sample out of a captured USB transfer", () => {
    // Straight off the wire: OUT `01 02 05 02` answered by this on IN 2.
    const transfer = new Uint8Array([0x00, 0x03, 0xc0, 0x00, 0x05, 0xd9, 0x5a]);
    expect(decodeMotionNotification(usbPacketBody(transfer))).toBe(0x5ad9);
    expect(echoTimeToMetres(0x5ad9)).toBeCloseTo(4.0, 2);
  });

  it("tells a captured event packet apart from an answer", () => {
    // Both off the wire. The 0x85 event arrives unprompted between answers.
    const event = new Uint8Array([0x00, 0x03, 0x85, 0x96, 0x0f, 0x62, 0x00, 0x04]);
    const answer = new Uint8Array([0x00, 0x03, 0xc0, 0x00, 0x05, 0xd9, 0x5a]);
    expect(isResultPacket(usbPacketBody(event))).toBe(false);
    expect(isResultPacket(usbPacketBody(answer))).toBe(true);
  });

  it("finds the packet whether or not the USB header is echoed back", () => {
    const bare = new Uint8Array([0xc0, 0x00, 0x05, 0x88, 0x13]);
    const prefixed = new Uint8Array([0x00, 0x03, 0xc0, 0x00, 0x05, 0x88, 0x13]);
    expect(decodeMotionNotification(usbPacketBody(bare))).toBe(5000);
    expect(decodeMotionNotification(usbPacketBody(prefixed))).toBe(5000);
  });

  it("starts and stops the device's own sampler", () => {
    // 20 Hz is 50 ms, and the period is eleven bits little-endian.
    expect(bytes(startSamplingCommand(50))).toEqual([0x06, 0x32, 0x00]);
    expect(bytes(startSamplingCommand(4))).toEqual([0x06, 0x04, 0x00]);
    expect(bytes(stopSamplingCommand())).toEqual([0x07]);
  });

  it("decodes streamed samples captured off the wire", () => {
    // `01 04 1b d9 5a` — service 1, characteristic 4, sequence 0x1b, echo 0x5ad9.
    const transfer = new Uint8Array([0x01, 0x04, 0x1b, 0xd9, 0x5a]);
    expect(decodeStreamPacket(usbPacketBody(transfer))).toEqual({
      sequence: 0x1b,
      echoTimeMicroseconds: 0x5ad9,
    });
  });

  it("keeps results and events out of the streamed-sample path", () => {
    // 0xc0 and 0x85 both exceed the five-bit sequence space, so neither can be
    // mistaken for a sample however the transfer is sliced.
    expect(decodeStreamPacket(new Uint8Array([0xc0, 0x00, 0x05, 0xd9, 0x5a]))).toBeNull();
    expect(decodeStreamPacket(new Uint8Array([0x85, 0x96, 0x0f, 0x62]))).toBeNull();
    expect(decodeStreamPacket(new Uint8Array([0x1b, 0xd9]))).toBeNull();
  });

  it("acknowledges a run of streamed samples", () => {
    // `01 05 00 00 00 00 1f` on the wire, minus its service/characteristic header.
    expect(bytes(streamAckCommand(0x1f))).toEqual([0x00, 0x00, 0x00, 0x00, 0x1f]);
    expect(bytes(streamAckCommand(0x07))).toEqual([0x00, 0x00, 0x00, 0x00, 0x07]);
    expect(STREAM_ACK_INTERVAL).toBe(8);
  });

  it("converts ultrasonic round-trip time to metres", () => {
    expect(echoTimeToMetres(5000)).toBeCloseTo(0.86, 10);
  });
});
