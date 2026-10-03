/**
 * The sensor source's handling of a recording's edges, against a fake device.
 *
 * The transports themselves are tested on their own; these tests replace the
 * USB one with a device whose stream is driven by hand, which is the only way
 * to make a stream go quiet on cue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionState } from "../../../src/common/model/ConnectionState.js";
import { SensorPositionSource, SensorTransport } from "../../../src/common/model/SensorPositionSource.js";
import { SPEED_OF_SOUND_MPS } from "../../../src/sensor/model/PascoMotionProtocol.js";

/** The echo time the device would report for a target `metres` away. */
function metresToEchoTime(metres: number): number {
  return ((2 * metres) / SPEED_OF_SOUND_MPS) * 1_000_000;
}

// Hoisted with the mock below, which runs before this file's own top level.
const { FakeStreamingDevice } = vi.hoisted(() => {
  /** Enough of a PS-3219 to stream on command. */
  class FakeDevice {
    public static latest: FakeDevice | null = null;

    public isConnected = false;
    public readonly name = "Fake Motion Sensor";
    public onSample: ((echoTimeMicroseconds: number) => void) | null = null;
    public readonly echoTimes: number[] = [];

    public constructor() {
      FakeDevice.latest = this;
    }

    public connect(): Promise<void> {
      this.isConnected = true;
      return Promise.resolve();
    }

    public disconnect(): Promise<void> {
      this.isConnected = false;
      return Promise.resolve();
    }

    public readEchoTime(): Promise<number> {
      const next = this.echoTimes.shift();
      return next === undefined ? Promise.reject(new Error("no reading")) : Promise.resolve(next);
    }

    public setRange(): Promise<void> {
      return Promise.resolve();
    }

    public setSamplePeriod(): Promise<void> {
      return Promise.resolve();
    }

    public startStreaming(_periodMs: number, onSample: (echoTimeMicroseconds: number) => void): Promise<void> {
      this.onSample = onSample;
      return Promise.resolve();
    }

    public stopStreaming(): Promise<void> {
      this.onSample = null;
      return Promise.resolve();
    }

    /** Pushes one sample at `metres`, as the device would on its own clock. */
    public push(metres: number): void {
      this.onSample?.(metresToEchoTime(metres));
    }
  }

  return { FakeStreamingDevice: FakeDevice };
});

type FakeStreamingDevice = InstanceType<typeof FakeStreamingDevice>;

vi.mock("../../../src/sensor/model/UsbMotionSensor.js", () => ({
  UsbMotionSensor: FakeStreamingDevice,
}));

async function connectedSource(): Promise<{ source: SensorPositionSource; device: FakeStreamingDevice }> {
  const source = new SensorPositionSource();
  await source.connect(SensorTransport.USB);
  const device = FakeStreamingDevice.latest;
  if (device === null) {
    throw new Error("no device constructed");
  }
  return { source, device };
}

describe("SensorPositionSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    FakeStreamingDevice.latest = null;
  });

  describe("a stream that goes quiet", () => {
    it("ends sampling once samples stop arriving mid-recording", async () => {
      const { source, device } = await connectedSource();
      source.startSampling();
      for (let i = 0; i < 20; i++) {
        device.push(1);
        vi.advanceTimersByTime(40);
      }
      expect(source.isAvailableProperty.value).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(source.isAvailableProperty.value).toBe(false);
      expect(source.connectionStateProperty.value).toBe(ConnectionState.ERROR);
      expect(device.onSample).toBeNull();
      source.dispose();
    });

    it("does not end a stream that keeps arriving, however long it runs", async () => {
      const { source, device } = await connectedSource();
      source.startSampling();
      for (let i = 0; i < 200; i++) {
        device.push(1);
        vi.advanceTimersByTime(40);
      }
      expect(source.isAvailableProperty.value).toBe(true);
      source.dispose();
    });

    it("falls back to polling when the stream never starts", async () => {
      const { source, device } = await connectedSource();
      device.echoTimes.push(metresToEchoTime(1.5));
      source.startSampling();

      await vi.advanceTimersByTimeAsync(1000);

      expect(source.isAvailableProperty.value).toBe(true);
      expect(source.positionProperty.value).toBeCloseTo(1.5, 3);
      source.dispose();
    });

    it("is not armed once sampling has stopped", async () => {
      const { source, device } = await connectedSource();
      source.startSampling();
      device.push(1);
      source.stopSampling();

      vi.advanceTimersByTime(5000);

      expect(source.isAvailableProperty.value).toBe(true);
      source.dispose();
    });
  });

  describe("zero at start", () => {
    it("zeroes on the run's first reading, not on a republished stale one", async () => {
      const { source, device } = await connectedSource();
      source.startSampling();
      device.push(1.8); // where the previous run ended
      source.stopSampling();

      source.zeroAtStartProperty.value = true;
      source.startSampling();
      // An adjustment while the new run waits for its first reading republishes
      // the stale 1.8 m; it must not be taken as this run's zero.
      source.changeSignProperty.value = true;
      expect(source.zeroOffsetProperty.value).toBe(0);
      expect(source.hasFreshReading()).toBe(false);

      device.push(0.6);

      expect(source.zeroOffsetProperty.value).toBeCloseTo(0.6, 3);
      expect(source.positionProperty.value).toBeCloseTo(0, 3);
      expect(source.hasFreshReading()).toBe(true);
      source.dispose();
    });
  });
});
