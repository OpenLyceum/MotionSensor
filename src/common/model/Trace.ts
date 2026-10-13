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
import { type Sample, trailingDerivativeAt } from "./motionMath.js";

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

  /**
   * The derived series, each extended by one value per sample. Every stage is
   * causal, so a value is final the moment it is computed: appending is exact,
   * and costs one window's work per sample rather than a pass over the whole
   * recording — which, at 50 Hz near the end of a minute, used to mean
   * thousands of small arrays allocated per sample, twice.
   */
  private smoothedSamples: Sample[] = [];
  private velocitySamples: Sample[] = [];
  private accelerationSamples: Sample[] = [];

  /**
   * Sets the rate the next samples are recorded at. Meant for an empty trace —
   * the model calls it as a recording is being reset — but anything already
   * recorded is re-derived at the new window rather than left inconsistent.
   */
  public setSampleRate(sampleRateHz: number): void {
    this.windowSamples = windowSamplesForRate(sampleRateHz);
    const recorded = this.samples;
    this.clear();
    for (const sample of recorded) {
      this.add(sample.time, sample.value);
    }
  }

  /**
   * Records one position sample and extends each derived series by one value.
   *
   * Each stage waits for the one before it: a smoothed value is a full mean
   * only from sample `windowSamples - 1` on (earlier ones average fewer points,
   * which lags a ramp by a varying amount and would halve its slope), so
   * velocity is defined from one window after that, and acceleration from one
   * window after velocity. Before then each reads 0.
   */
  public add(time: number, position: number): void {
    this.samples.push({ time: time, value: position });
    const index = this.samples.length - 1;
    const window = this.windowSamples;

    const smoothingStart = Math.max(0, index - window + 1);
    let sum = 0;
    for (let i = smoothingStart; i <= index; i++) {
      sum += (this.samples[i] as Sample).value;
    }
    this.smoothedSamples.push({ time: time, value: sum / (index - smoothingStart + 1) });

    this.velocitySamples.push({
      time: time,
      value: trailingDerivativeAt(this.smoothedSamples, index, window, window - 1),
    });
    this.accelerationSamples.push({
      time: time,
      value: trailingDerivativeAt(this.velocitySamples, index, window, 2 * (window - 1)),
    });
  }

  /** Discards the run. */
  public clear(): void {
    this.samples = [];
    this.smoothedSamples = [];
    this.velocitySamples = [];
    this.accelerationSamples = [];
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

  /** The causal velocity series, differentiated from the smoothed position. */
  public getVelocitySamples(): readonly Sample[] {
    return this.velocitySamples;
  }

  /**
   * The causal acceleration series, differentiated from {@link getVelocitySamples}.
   * Differentiating twice doubles the lag and squares the noise, so this is by
   * some distance the roughest of the three series — see doc/model.md.
   */
  public getAccelerationSamples(): readonly Sample[] {
    return this.accelerationSamples;
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
