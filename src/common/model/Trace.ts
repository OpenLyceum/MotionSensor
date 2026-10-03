/**
 * Trace.ts
 *
 * The recorded run: position sampled on the model's fixed clock, plus the
 * velocity and acceleration derived from it. The clock's rate is the student's
 * choice, so the windows below are counted from a fixed *duration* rather than
 * from a fixed number of samples — 0.2 s of smoothing at 5 Hz and at 50 Hz.
 *
 * Velocity is always differentiated here, host-side, even on the Motion Sensor
 * screen where the device could report its own. Two reasons: the sensor's
 * derivative uses a different window from ours, so the two screens would not
 * agree on the same motion; and reading one measurement per BLE round trip
 * instead of three keeps the poll rate up.
 *
 * Every derivative is *trailing*, never centred. A centred window would let a
 * sample recorded later change the shape of the curve already drawn, so the plot
 * would rewrite its own past as you watched it. The cost is a half-window of lag
 * — the honest price of a causal filter.
 */

import { DEFAULT_SAMPLE_RATE_HZ, windowSamplesForRate } from "../../MotionSensorConstants.js";
import { differentiateTrailing, type Sample } from "./motionMath.js";

export class Trace {
  /** Position samples, in metres, in recording order. */
  private samples: Sample[] = [];

  /**
   * Samples spanning the smoothing / derivative interval at the rate this trace
   * was recorded at. Held per-trace rather than read from the model on every
   * call, so a rate chosen for the *next* recording cannot silently re-shape the
   * velocity curve of the one already on screen.
   */
  private windowSamples = windowSamplesForRate(DEFAULT_SAMPLE_RATE_HZ);

  /** Cached velocity series; invalidated whenever a sample is added. */
  private velocityCache: Sample[] | null = null;
  /** Cached acceleration series; invalidated whenever a sample is added. */
  private accelerationCache: Sample[] | null = null;
  /** Causal smoothed values, finalized as each raw sample arrives. */
  private smoothedSamples: Sample[] = [];

  /**
   * Sets the rate the next samples are recorded at. Only meaningful on an empty
   * trace — call it from the model as a recording is being reset.
   */
  public setSampleRate(sampleRateHz: number): void {
    this.windowSamples = windowSamplesForRate(sampleRateHz);
    this.velocityCache = null;
    this.accelerationCache = null;
  }

  /** Records one position sample. */
  public add(time: number, position: number): void {
    this.samples.push({ time: time, value: position });
    const smoothingStart = Math.max(0, this.samples.length - this.windowSamples);
    const smoothingWindow = this.samples.slice(smoothingStart);
    this.smoothedSamples.push({
      time: time,
      value: smoothingWindow.reduce((sum, sample) => sum + sample.value, 0) / smoothingWindow.length,
    });
    this.velocityCache = null;
    this.accelerationCache = null;
  }

  /** Discards the run. */
  public clear(): void {
    this.samples = [];
    this.smoothedSamples = [];
    this.velocityCache = null;
    this.accelerationCache = null;
  }

  public get length(): number {
    return this.samples.length;
  }

  public get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  /** The recorded position series. */
  public getPositionSamples(): readonly Sample[] {
    return this.samples;
  }

  /**
   * Position samples with a short trailing average. Each value is finalized
   * when recorded, so later samples cannot alter the displayed past.
   */
  public getSmoothedPositionSamples(): readonly Sample[] {
    return this.smoothedSamples;
  }

  /**
   * The causal velocity series, recomputed lazily from finalized values.
   *
   * Each stage waits for the one before it: a smoothed value is a full mean
   * only from sample `windowSamples - 1` on (earlier ones average fewer points,
   * which lags a ramp by a varying amount and would halve its slope), so
   * velocity is defined from one window after that, and acceleration from one
   * window after velocity. Before then each reads 0.
   */
  public getVelocitySamples(): readonly Sample[] {
    if (this.velocityCache === null) {
      this.velocityCache = differentiateTrailing(
        this.getSmoothedPositionSamples(),
        this.windowSamples,
        this.windowSamples - 1,
      );
    }
    return this.velocityCache;
  }

  /**
   * The causal acceleration series, differentiated from {@link getVelocitySamples}.
   * Differentiating twice doubles the lag and squares the noise, so this is by
   * some distance the roughest of the three series — see doc/model.md.
   */
  public getAccelerationSamples(): readonly Sample[] {
    if (this.accelerationCache === null) {
      this.accelerationCache = differentiateTrailing(
        this.getVelocitySamples(),
        this.windowSamples,
        2 * (this.windowSamples - 1),
      );
    }
    return this.accelerationCache;
  }

  /** Value of the most recent sample in a series, or 0 before the first one. */
  public static latestValue(samples: readonly Sample[]): number {
    return samples[samples.length - 1]?.value ?? 0;
  }

  /** Position of the most recent sample, or null before the first one. */
  public getLatestPosition(): number | null {
    const last = this.samples[this.samples.length - 1];
    return last === undefined ? null : last.value;
  }
}
