/**
 * MotionSensorModel.ts
 *
 * Everything both screens share: where the recording is in its lifecycle, the
 * recorded trace, and the live position / velocity / acceleration the graph
 * samples from.
 *
 * The two screens differ in exactly one way — where position comes from — so the
 * source is chosen once, at construction, and nothing below branches on it.
 *
 * ── One clock, two screens ────────────────────────────────────────────────────
 * The trace is sampled on a fixed-timestep accumulator rather than on raw frame
 * dt. A recording therefore has the same number of samples, at the same
 * instants, whether it came from a 144 Hz display dragging a walker or from a
 * sensor answering every 40 ms. The rate of that clock is chosen by the student
 * ({@link sampleRateProperty}) and captured when a recording starts. Two runs at
 * the same rate are comparable across screens and machines, and the graph's time
 * axis is evenly spaced instead of bunching wherever the browser happened to be
 * busy.
 *
 * {@link sampleEmitter} fires on that clock, which is what the view feeds the
 * graph from — not the frame loop.
 */

import {
  BooleanProperty,
  DerivedProperty,
  Emitter,
  NumberProperty,
  Property,
  type TReadOnlyProperty,
} from "scenerystack/axon";
import type { TModel } from "scenerystack/joist";
import { DEFAULT_SAMPLE_RATE_HZ, MAX_RECORD_DURATION_S, SAMPLE_RATE_CHOICES_HZ } from "../../MotionSensorConstants.js";
import MotionSensorNamespace from "../../MotionSensorNamespace.js";
import type { Sample } from "./motionMath.js";
import type { PositionSourceTypeValue, TPositionSource } from "./PositionSource.js";
import { RunState, type RunStateValue } from "./RunState.js";
import { Trace } from "./Trace.js";

/**
 * A dt larger than this is a tab that was backgrounded, not a slow frame.
 * Clamping stops the accumulator from firing hundreds of catch-up samples and
 * recording a flat line for time the student was not actually there for.
 */
const MAXIMUM_DT_S = 0.25;

/**
 * Slack for the accumulator comparison. A whole number of period-sized ticks does
 * not sum to a whole number in binary, and without this the loop would
 * occasionally hold a sample back for one extra frame.
 */
const TIME_EPSILON_S = 1e-9;

export type MotionSensorModelOptions = {
  /** Which source this screen is locked to. */
  readonly sourceType: PositionSourceTypeValue;
  /** The source itself, constructed by the screen model. */
  readonly source: TPositionSource;
};

export class MotionSensorModel implements TModel {
  public readonly sourceType: PositionSourceTypeValue;
  public readonly source: TPositionSource;

  public readonly runStateProperty: Property<RunStateValue>;

  /** Seconds elapsed in the current recording, in exact sample-period steps. */
  public readonly timeProperty: NumberProperty;

  /**
   * How many samples a second the next recording takes, in hertz. A student's
   * choice: a slow walk read at 5 Hz gives a table short enough to copy out by
   * hand, while a cart run at 50 Hz resolves a bounce. It takes effect at the
   * next Record — changing it mid-recording would make sample times, which are
   * `index x period`, disagree with the samples already taken.
   */
  public readonly sampleRateProperty: NumberProperty;

  /**
   * The three kinematic quantities, as of the most recent sample. These are what
   * the ConfigurableGraph plots: it holds a Property per axis and reads its
   * current value, so anything a student can put on an axis has to live here.
   *
   * Position mirrors the source; velocity and acceleration are trailing
   * derivatives of the trace, so they are zero until the window fills.
   */
  public readonly positionProperty: NumberProperty;
  public readonly velocityProperty: NumberProperty;
  public readonly accelerationProperty: NumberProperty;

  /**
   * Fires once per recorded sample, on the fixed clock. The view adds a point to
   * the graph from this rather than from step(), so points are evenly spaced in
   * time however the frame rate wanders.
   */
  public readonly sampleEmitter: Emitter;

  /** True whenever the trace changed, so the view can redraw only when needed. */
  public readonly traceChangedProperty: BooleanProperty;

  /** Whether recording can begin right now. */
  public readonly canRecordProperty: TReadOnlyProperty<boolean>;

  private readonly trace: Trace;

  /** Leftover time not yet consumed by a whole sample period. */
  private timeAccumulator = 0;

  /**
   * The period the current recording is being taken at, captured when it was
   * reset. Held rather than read from {@link sampleRateProperty} on each tick so
   * that a rate change can never land in the middle of a run and put two
   * spacings on one trace.
   */
  private samplePeriod = 1 / DEFAULT_SAMPLE_RATE_HZ;

  /** Samples the current recording may hold before it stops itself. */
  private maximumSamples = Math.round(MAX_RECORD_DURATION_S * DEFAULT_SAMPLE_RATE_HZ);

  /** How many samples the current recording holds. Integer, never derived from a float. */
  private sampleIndex = 0;

  /**
   * True from Record until the source has a reading taken for this run. The
   * clock does not start until then: t = 0 is where the student stood when the
   * recording began, not where a silent sensor last saw them.
   */
  private awaitingFirstReading = false;

  /** Mirrors the source onto positionProperty while idle, so the graph is live before Record. */
  private readonly sourcePositionListener: (position: number) => void;

  /** Ends a recording whose source has gone away. */
  private readonly sourceAvailabilityListener: (available: boolean) => void;

  /** Guards against a second dispose(); axon Properties throw if disposed twice. */
  private isDisposed = false;

  public constructor(providedOptions: MotionSensorModelOptions) {
    this.sourceType = providedOptions.sourceType;
    this.source = providedOptions.source;

    this.trace = new Trace();

    this.runStateProperty = new Property<RunStateValue>(RunState.READY);
    this.timeProperty = new NumberProperty(0, { units: "s" });
    this.sampleRateProperty = new NumberProperty(DEFAULT_SAMPLE_RATE_HZ, {
      units: "Hz",
      validValues: [...SAMPLE_RATE_CHOICES_HZ],
    });
    this.positionProperty = new NumberProperty(this.source.positionProperty.value, { units: "m" });
    this.velocityProperty = new NumberProperty(0, { units: "m/s" });
    this.accelerationProperty = new NumberProperty(0, { units: "m/s^2" });
    this.sampleEmitter = new Emitter();
    this.traceChangedProperty = new BooleanProperty(false);

    this.canRecordProperty = new DerivedProperty(
      [this.runStateProperty, this.source.isAvailableProperty],
      (state, available) => available && state !== RunState.RECORDING,
    );

    // Position follows the source even when nothing is being recorded, so the
    // walker's readout and a position-on-an-axis graph are honest before the
    // first press of Record. Once a recording's clock has started it owns the
    // value instead, so that the value the graph samples is the one that went
    // into the trace.
    this.sourcePositionListener = (position: number) => {
      if (this.runStateProperty.value !== RunState.RECORDING || this.awaitingFirstReading) {
        this.positionProperty.value = position;
      }
    };
    this.source.positionProperty.link(this.sourcePositionListener);

    // A sensor that disconnects, or stops answering, mid-recording would
    // otherwise leave the clock sampling its last reading for up to a minute —
    // a flat line that reads as a student standing still. The trace up to the
    // loss is real, so it stands; nothing after it is recorded.
    this.sourceAvailabilityListener = (available: boolean) => {
      if (!available) {
        this.stopRecording();
      }
    };
    this.source.isAvailableProperty.lazyLink(this.sourceAvailabilityListener);
  }

  /** The recorded position series, unsmoothed. */
  public getPositionSamples(): readonly Sample[] {
    return this.trace.getPositionSamples();
  }

  /** Position samples with a short trailing average, for the motion diagram. */
  public getSmoothedPositionSamples(): readonly Sample[] {
    return this.trace.getSmoothedPositionSamples();
  }

  /**
   * The four recorded quantities as bare number series, index-aligned with each
   * other. This is what lets the graph redraw one recording on a new pair of
   * axes instead of blanking — see {@link PlottableProperty}. Recomputed on
   * demand, which is cheap because it only happens when an axis changes.
   */
  public getTimeSeries(): readonly number[] {
    return this.trace.getPositionSamples().map((sample) => sample.time);
  }

  public getPositionSeries(): readonly number[] {
    return this.trace.getPositionSamples().map((sample) => sample.value);
  }

  public getVelocitySeries(): readonly number[] {
    return this.trace.getVelocitySamples().map((sample) => sample.value);
  }

  public getAccelerationSeries(): readonly number[] {
    return this.trace.getAccelerationSamples().map((sample) => sample.value);
  }

  /** Begins recording. No effect unless the source is available. */
  public startRecording(): void {
    if (!this.canRecordProperty.value) {
      return;
    }
    this.resetRecording();
    this.source.startSampling();
    this.runStateProperty.value = RunState.RECORDING;

    // t = 0 is a real sample, not an empty origin: the graph should show a point
    // the instant recording starts rather than a period later. A source that
    // has nothing current yet — a sensor between runs — gets it on the first
    // step after its first reading instead.
    this.awaitingFirstReading = true;
    this.recordFirstSampleIfReady();
  }

  /** Ends recording early. The trace stands. */
  public stopRecording(): void {
    if (this.runStateProperty.value !== RunState.RECORDING) {
      return;
    }
    this.source.stopSampling();
    this.awaitingFirstReading = false;
    this.runStateProperty.value = RunState.STOPPED;
    this.traceChangedProperty.value = !this.traceChangedProperty.value;
  }

  /** Discards the trace and returns to READY. */
  public clearRun(): void {
    this.resetRecording();
    this.runStateProperty.value = RunState.READY;
    this.velocityProperty.value = 0;
    this.accelerationProperty.value = 0;
    this.positionProperty.value = this.source.positionProperty.value;
  }

  public step(dt: number): void {
    if (this.runStateProperty.value !== RunState.RECORDING) {
      return;
    }

    const clampedDt = Math.min(dt, MAXIMUM_DT_S);
    this.source.step(clampedDt);

    // The clock starts at the first reading; until then there is no time to keep.
    if (this.awaitingFirstReading) {
      this.recordFirstSampleIfReady();
      return;
    }

    // Fixed-timestep sampling: consume whole sample periods, keep the remainder.
    this.timeAccumulator += clampedDt;
    let recorded = false;

    while (
      this.timeAccumulator >= this.samplePeriod - TIME_EPSILON_S &&
      this.runStateProperty.value === RunState.RECORDING
    ) {
      this.timeAccumulator -= this.samplePeriod;
      this.recordSample();
      recorded = true;

      // A recording left running all lesson would grow without bound and outrun
      // the graph's own buffer. Stopping is better than silently dropping the
      // beginning of the motion the student was watching.
      if (this.sampleIndex >= this.maximumSamples) {
        this.stopRecording();
      }
    }

    if (recorded) {
      this.traceChangedProperty.value = !this.traceChangedProperty.value;
    }
  }

  /** Takes the t = 0 sample once the source has a reading for this run. */
  private recordFirstSampleIfReady(): void {
    if (this.awaitingFirstReading && this.source.hasFreshReading()) {
      this.awaitingFirstReading = false;
      this.recordSample();
      this.traceChangedProperty.value = !this.traceChangedProperty.value;
    }
  }

  /**
   * Takes one sample at the current sample index and republishes the three
   * kinematic Properties from it.
   *
   * Sample times come from the index, so they are exact multiples of the period
   * however many frames the recording took.
   */
  private recordSample(): void {
    const time = this.sampleIndex * this.samplePeriod;
    const position = this.source.positionProperty.value;
    this.trace.add(time, position);
    this.sampleIndex += 1;

    this.timeProperty.value = time;
    this.positionProperty.value = position;
    this.velocityProperty.value = Trace.latestValue(this.trace.getVelocitySamples());
    this.accelerationProperty.value = Trace.latestValue(this.trace.getAccelerationSamples());

    this.sampleEmitter.emit();
  }

  /**
   * Empties the trace and restarts the clock, leaving the run state alone. The
   * chosen sample rate is picked up here, which is what makes it take effect at
   * the next Record rather than in the middle of a run.
   *
   * Leaves the source silent: only {@link startRecording} asks it for readings,
   * so clearing a run can never set a sensor ranging with nothing recording.
   */
  private resetRecording(): void {
    this.source.stopSampling();
    this.awaitingFirstReading = false;
    const sampleRate = this.sampleRateProperty.value;
    this.samplePeriod = 1 / sampleRate;
    this.maximumSamples = Math.round(MAX_RECORD_DURATION_S * sampleRate);
    this.trace.clear();
    this.trace.setSampleRate(sampleRate);
    this.timeProperty.value = 0;
    this.timeAccumulator = 0;
    this.sampleIndex = 0;
    this.traceChangedProperty.value = !this.traceChangedProperty.value;
  }

  public reset(): void {
    this.sampleRateProperty.reset();
    this.clearRun();
    this.source.reset();
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.source.positionProperty.unlink(this.sourcePositionListener);
    this.source.isAvailableProperty.unlink(this.sourceAvailabilityListener);
    this.canRecordProperty.dispose();
    this.runStateProperty.dispose();
    this.timeProperty.dispose();
    this.sampleRateProperty.dispose();
    this.positionProperty.dispose();
    this.velocityProperty.dispose();
    this.accelerationProperty.dispose();
    this.sampleEmitter.dispose();
    this.traceChangedProperty.dispose();
    this.source.stopSampling();
    this.source.dispose();
  }
}

MotionSensorNamespace.register("MotionSensorModel", MotionSensorModel);
