/**
 * The recording lifecycle.
 *
 * The rule these tests are really guarding is that the clock is the model's own,
 * not the browser's: sample times are exact multiples of the sample period
 * however ragged the frames were, and the recording ends on a sample count
 * rather than on an accumulated float. Everything else — velocity and
 * acceleration signs, clearing, the duration cap — follows from that.
 */

import { BooleanProperty, NumberProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MotionSensorModel } from "../../../src/common/model/MotionSensorModel.js";
import { PointerPositionSource } from "../../../src/common/model/PointerPositionSource.js";
import { PositionSourceType, type TPositionSource } from "../../../src/common/model/PositionSource.js";
import { RunState } from "../../../src/common/model/RunState.js";
import { Trace } from "../../../src/common/model/Trace.js";
import {
  DEFAULT_SAMPLE_PERIOD_S,
  DEFAULT_SAMPLE_RATE_HZ,
  MAX_RECORD_DURATION_S,
  SAMPLE_RATE_CHOICES_HZ,
} from "../../../src/MotionSensorConstants.js";

/**
 * Stands in for the PASCO link: silent until sampling starts, then current only
 * once a reading arrives — which a test delivers with {@link deliver}.
 */
class FakeSensorSource implements TPositionSource {
  public readonly sourceType = PositionSourceType.MOTION_SENSOR;
  public readonly sensorPositionProperty = new NumberProperty(0);
  public readonly availableProperty = new BooleanProperty(true);
  public isSampling = false;
  private fresh = false;

  public get positionProperty(): TReadOnlyProperty<number> {
    return this.sensorPositionProperty;
  }

  public get isAvailableProperty(): TReadOnlyProperty<boolean> {
    return this.availableProperty;
  }

  public startSampling(): void {
    this.isSampling = true;
    this.fresh = false;
  }

  public stopSampling(): void {
    this.isSampling = false;
    this.fresh = false;
  }

  public hasFreshReading(): boolean {
    return this.fresh;
  }

  /** A reading from the device; ignored unless sampling, as the real link would be silent. */
  public deliver(position: number): void {
    if (this.isSampling) {
      this.sensorPositionProperty.value = position;
      this.fresh = true;
    }
  }

  public step(_dt: number): void {
    // intentionally empty
  }

  public reset(): void {
    this.stopSampling();
  }

  public dispose(): void {
    this.sensorPositionProperty.dispose();
    this.availableProperty.dispose();
  }
}

/** Steps the model in sample-sized ticks, as the sim's clock does. */
function advance(model: MotionSensorModel, seconds: number): void {
  const ticks = Math.round(seconds / DEFAULT_SAMPLE_PERIOD_S);
  for (let i = 0; i < ticks; i++) {
    model.step(DEFAULT_SAMPLE_PERIOD_S);
  }
}

describe("MotionSensorModel", () => {
  let source: PointerPositionSource;
  let model: MotionSensorModel;

  beforeEach(() => {
    source = new PointerPositionSource();
    model = new MotionSensorModel({ sourceType: PositionSourceType.POINTER, source: source });
  });

  it("starts ready, with nothing recorded", () => {
    expect(model.runStateProperty.value).toBe(RunState.READY);
    expect(model.getPositionSamples()).toHaveLength(0);
    expect(model.timeProperty.value).toBe(0);
  });

  it("records from the moment Record is pressed until Stop", () => {
    model.startRecording();
    expect(model.runStateProperty.value).toBe(RunState.RECORDING);

    // t = 0 is a real sample taken at startRecording, so one second of ticks
    // leaves 1 / DEFAULT_SAMPLE_PERIOD_S + 1 samples on the trace.
    advance(model, 1);
    expect(model.getPositionSamples()).toHaveLength(Math.round(1 / DEFAULT_SAMPLE_PERIOD_S) + 1);

    model.stopRecording();
    expect(model.runStateProperty.value).toBe(RunState.STOPPED);
  });

  it("samples the source only while recording", () => {
    const startSampling = vi.spyOn(source, "startSampling");
    const stopSampling = vi.spyOn(source, "stopSampling");

    model.startRecording();
    expect(startSampling).toHaveBeenCalledOnce();

    advance(model, 1);
    model.stopRecording();
    expect(stopSampling).toHaveBeenCalled();

    // Stepping past the end adds nothing.
    const settled = model.getPositionSamples().length;
    advance(model, 1);
    expect(model.getPositionSamples()).toHaveLength(settled);
  });

  it("puts sample times on exact multiples of the period, whatever the frame times were", () => {
    model.startRecording();
    // Deliberately ugly frame times: a fast frame, a slow one, a stall.
    for (const dt of [0.004, 0.031, 0.12, 0.008, 0.2, 0.017]) {
      model.step(dt);
    }
    const samples = model.getPositionSamples();
    expect(samples.length).toBeGreaterThan(1);
    samples.forEach((sample, index) => {
      expect(sample.time).toBeCloseTo(index * DEFAULT_SAMPLE_PERIOD_S, 12);
    });
  });

  it("clamps a huge dt instead of firing a burst of catch-up samples", () => {
    model.startRecording();
    // A backgrounded tab returns with one enormous dt. Ten seconds of it must
    // not become ten seconds of flat trace the student was never present for.
    model.step(10);
    expect(model.getPositionSamples().length).toBeLessThanOrEqual(Math.round(0.25 / DEFAULT_SAMPLE_PERIOD_S) + 1);
  });

  it("derives a positive velocity from motion away from the sensor", () => {
    model.startRecording();
    // Walk outward at a steady 0.5 m/s for long enough to fill the smoothing
    // and derivative windows.
    for (let i = 1; i <= 40; i++) {
      source.walkerPositionProperty.value = Math.min(2, i * 0.5 * DEFAULT_SAMPLE_PERIOD_S);
      model.step(DEFAULT_SAMPLE_PERIOD_S);
    }
    expect(model.velocityProperty.value).toBeGreaterThan(0);
  });

  it("derives a negative velocity from motion toward the sensor", () => {
    source.walkerPositionProperty.value = 2;
    model.startRecording();
    for (let i = 1; i <= 40; i++) {
      source.walkerPositionProperty.value = Math.max(0, 2 - i * 0.5 * DEFAULT_SAMPLE_PERIOD_S);
      model.step(DEFAULT_SAMPLE_PERIOD_S);
    }
    expect(model.velocityProperty.value).toBeLessThan(0);
  });

  it("reports zero velocity and acceleration while standing still", () => {
    source.walkerPositionProperty.value = 1;
    model.startRecording();
    advance(model, 3);
    expect(model.velocityProperty.value).toBeCloseTo(0, 6);
    expect(model.accelerationProperty.value).toBeCloseTo(0, 6);
  });

  it("stops itself at the duration cap", () => {
    model.startRecording();
    advance(model, MAX_RECORD_DURATION_S + 1);
    expect(model.runStateProperty.value).toBe(RunState.STOPPED);
    expect(model.timeProperty.value).toBeLessThanOrEqual(MAX_RECORD_DURATION_S);
  });

  it("clears the trace, the clock and the derived quantities", () => {
    model.startRecording();
    for (let i = 1; i <= 20; i++) {
      source.walkerPositionProperty.value = i * 0.05;
      model.step(DEFAULT_SAMPLE_PERIOD_S);
    }
    model.stopRecording();

    model.clearRun();
    expect(model.runStateProperty.value).toBe(RunState.READY);
    expect(model.getPositionSamples()).toHaveLength(0);
    expect(model.timeProperty.value).toBe(0);
    expect(model.velocityProperty.value).toBe(0);
    expect(model.accelerationProperty.value).toBe(0);
  });

  it("recording again after a stop discards the first trace", () => {
    model.startRecording();
    advance(model, 2);
    expect(model.getPositionSamples().length).toBeGreaterThan(1);
    model.stopRecording();

    model.startRecording();
    expect(model.getPositionSamples()).toHaveLength(1);
    expect(model.timeProperty.value).toBe(0);
  });

  it("ignores Record while already recording, so a stray press cannot lose the trace", () => {
    model.startRecording();
    advance(model, 2);
    const during = model.getPositionSamples().length;

    model.startRecording();
    expect(model.getPositionSamples()).toHaveLength(during);
    expect(model.runStateProperty.value).toBe(RunState.RECORDING);
  });

  it("emits once per recorded sample", () => {
    const listener = vi.fn();
    model.sampleEmitter.addListener(listener);

    model.startRecording();
    advance(model, 1);
    expect(listener).toHaveBeenCalledTimes(model.getPositionSamples().length);

    model.sampleEmitter.removeListener(listener);
  });

  it("tracks the source's position while idle, so the graph is live before Record", () => {
    source.walkerPositionProperty.value = 1.4;
    expect(model.positionProperty.value).toBeCloseTo(1.4, 12);
  });

  it("starts at the default sample rate", () => {
    expect(model.sampleRateProperty.value).toBe(DEFAULT_SAMPLE_RATE_HZ);
  });

  it("records at whichever rate was chosen, with times still on exact multiples", () => {
    for (const rate of SAMPLE_RATE_CHOICES_HZ) {
      model.sampleRateProperty.value = rate;
      model.startRecording();
      // One second of frames at the chosen period: t = 0 is a real sample, so a
      // second of ticks leaves rate + 1 of them.
      for (let i = 0; i < rate; i++) {
        model.step(1 / rate);
      }
      const samples = model.getPositionSamples();
      expect(samples).toHaveLength(rate + 1);
      samples.forEach((sample, index) => {
        expect(sample.time).toBeCloseTo(index / rate, 12);
      });
      model.stopRecording();
    }
  });

  it("holds a rate change until the next recording, so one trace has one spacing", () => {
    model.startRecording();
    advance(model, 1);
    model.sampleRateProperty.value = 5;

    // The run in progress keeps the rate it started with.
    advance(model, 1);
    const samples = model.getPositionSamples();
    samples.forEach((sample, index) => {
      expect(sample.time).toBeCloseTo(index * DEFAULT_SAMPLE_PERIOD_S, 12);
    });
    model.stopRecording();

    // The next one picks the new rate up.
    model.startRecording();
    for (let i = 0; i < 5; i++) {
      model.step(1 / 5);
    }
    expect(model.getPositionSamples()).toHaveLength(6);
    expect(model.timeProperty.value).toBeCloseTo(1, 12);
  });

  it("caps a recording by duration, not by sample count, at every rate", () => {
    for (const rate of SAMPLE_RATE_CHOICES_HZ) {
      model.sampleRateProperty.value = rate;
      model.startRecording();
      const ticks = Math.round((MAX_RECORD_DURATION_S + 1) * rate);
      for (let i = 0; i < ticks; i++) {
        model.step(1 / rate);
      }
      expect(model.runStateProperty.value).toBe(RunState.STOPPED);
      // The cap is a sample count — MAX_RECORD_DURATION_S x rate of them — so
      // the last sample lands one period short of the full minute, whatever the
      // rate. What must not happen is a rate changing how long a run may be.
      expect(model.getPositionSamples()).toHaveLength(MAX_RECORD_DURATION_S * rate);
      expect(model.timeProperty.value).toBeCloseTo(MAX_RECORD_DURATION_S - 1 / rate, 6);
    }
  });

  it("smooths over the same 0.2 s however fast it is sampling", () => {
    // A steady 0.5 m/s walk must read as 0.5 m/s at every rate: the derivative
    // window is a duration, so a slow rate is not smoothed into a lower speed.
    for (const rate of SAMPLE_RATE_CHOICES_HZ) {
      source.walkerPositionProperty.value = 0;
      model.sampleRateProperty.value = rate;
      model.startRecording();
      for (let i = 1; i <= 3 * rate; i++) {
        source.walkerPositionProperty.value = i * 0.5 * (1 / rate);
        model.step(1 / rate);
      }
      expect(model.velocityProperty.value).toBeCloseTo(0.5, 6);
      model.stopRecording();
    }
  });

  it("puts the rate back to the default on reset", () => {
    model.sampleRateProperty.value = 50;
    model.reset();
    expect(model.sampleRateProperty.value).toBe(DEFAULT_SAMPLE_RATE_HZ);
  });

  it("survives being disposed twice", () => {
    model.dispose();
    expect(() => model.dispose()).not.toThrow();
  });
});

describe("MotionSensorModel with a hardware source", () => {
  let source: FakeSensorSource;
  let model: MotionSensorModel;

  beforeEach(() => {
    source = new FakeSensorSource();
    model = new MotionSensorModel({ sourceType: PositionSourceType.MOTION_SENSOR, source: source });
  });

  it("leaves the sensor silent after Clear", () => {
    model.startRecording();
    source.deliver(1);
    advance(model, 1);
    model.stopRecording();
    model.clearRun();
    expect(model.runStateProperty.value).toBe(RunState.READY);
    expect(source.isSampling).toBe(false);
  });

  it("leaves the sensor silent after Reset All", () => {
    model.startRecording();
    model.reset();
    expect(source.isSampling).toBe(false);
  });

  it("starts the clock at the first reading of the run, not at the last one of the previous run", () => {
    // Where the student stood when the previous recording ended.
    source.sensorPositionProperty.value = 1.2;
    model.startRecording();
    expect(model.runStateProperty.value).toBe(RunState.RECORDING);

    // The link is slow to answer: no sample, and the clock does not run.
    advance(model, 0.2);
    expect(model.getPositionSamples()).toHaveLength(0);
    expect(model.timeProperty.value).toBe(0);

    source.deliver(0.4);
    model.step(DEFAULT_SAMPLE_PERIOD_S);
    expect(model.getPositionSamples()).toEqual([{ time: 0, value: 0.4 }]);

    advance(model, 1);
    const samples = model.getPositionSamples();
    expect(samples).toHaveLength(Math.round(1 / DEFAULT_SAMPLE_PERIOD_S) + 1);
    samples.forEach((sample, index) => {
      expect(sample.time).toBeCloseTo(index * DEFAULT_SAMPLE_PERIOD_S, 12);
      expect(sample.value).toBe(0.4);
    });
    expect(model.velocityProperty.value).toBe(0);
    expect(model.accelerationProperty.value).toBe(0);
  });

  it("feeds the graph nothing until that first reading", () => {
    const listener = vi.fn();
    model.sampleEmitter.addListener(listener);
    model.startRecording();
    advance(model, 0.5);
    expect(listener).not.toHaveBeenCalled();
    source.deliver(1);
    model.step(DEFAULT_SAMPLE_PERIOD_S);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("stops recording when the sensor goes away, keeping what was recorded", () => {
    model.startRecording();
    source.deliver(1);
    advance(model, 1);
    const recorded = model.getPositionSamples().length;

    source.availableProperty.value = false;
    expect(model.runStateProperty.value).toBe(RunState.STOPPED);
    expect(source.isSampling).toBe(false);

    advance(model, 1);
    expect(model.getPositionSamples()).toHaveLength(recorded);
  });

  it("stops a recording that was still waiting for its first reading when the sensor goes away", () => {
    model.startRecording();
    source.availableProperty.value = false;
    expect(model.runStateProperty.value).toBe(RunState.STOPPED);
    expect(model.getPositionSamples()).toHaveLength(0);
  });

  it("survives being disposed twice", () => {
    model.dispose();
    expect(() => model.dispose()).not.toThrow();
  });
});

describe("Trace start-up", () => {
  it("never reports a slope from a partly filled window", () => {
    // A step at the very start — the shape a stale or pre-zero first reading
    // used to leave — must not become a two-point slope.
    const trace = new Trace();
    trace.setSampleRate(20);
    trace.add(0, 1.2);
    for (let index = 1; index < 10; index++) {
      trace.add(index * 0.05, 0);
    }
    const velocity = trace.getVelocitySamples().map((s) => s.value);
    const acceleration = trace.getAccelerationSamples().map((s) => s.value);
    // Window is 4 samples at 20 Hz: velocity is defined from index 6 and
    // acceleration from index 9. Before that each reads 0 rather than the
    // -12 m/s and -240 m/s^2 a shrinking window used to report at index 1.
    expect(velocity.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(acceleration.slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reads a steady walk at its true speed from the first defined sample", () => {
    const trace = new Trace();
    trace.setSampleRate(20);
    for (let index = 0; index < 12; index++) {
      trace.add(index * 0.05, 0.5 * index * 0.05);
    }
    const velocity = trace.getVelocitySamples();
    for (const sample of velocity.slice(6)) {
      expect(sample.value).toBeCloseTo(0.5, 9);
    }
  });
});
