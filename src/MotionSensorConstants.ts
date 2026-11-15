/**
 * MotionSensorConstants.ts
 *
 * Central repository for every named numeric constant used across the
 * simulation. Bare numbers that carry semantic meaning (sizes, margins,
 * physics defaults, ranges) belong here rather than inline in model or view
 * code, so they are named, documented, and changed in one place.
 *
 * Conventions
 * ───────────
 *  - Physics / model values use SI units (metres, seconds, kilograms, …);
 *    note the unit in a comment on each value.
 *  - Layout / chrome values are in screen pixels.
 *  - Colour strings live in MotionSensorColors.ts, not here.
 *  - Computed expressions (e.g. `2 * Math.PI`) may stay inline.
 */

import { Range } from "scenerystack/dot";
import MotionSensorNamespace from "./MotionSensorNamespace.js";

// ── Layout / chrome (screen pixels) ───────────────────────────────────────────

/** Margin between the screen edge and edge-anchored controls (e.g. Reset All). */
export const SCREEN_VIEW_MARGIN = 20;

/** Corner radius shared by control panels and dialogs. */
export const PANEL_CORNER_RADIUS = 6;

/**
 * Plot area of the configurable graph, excluding axis labels and tick labels.
 * The graph can be resized by dragging a corner; this is where it starts and
 * where Reset All puts it back.
 */
export const GRAPH_WIDTH = 540;
export const GRAPH_HEIGHT = 300;

/**
 * Width of the control column on the right of both screens. Narrow enough to
 * leave the graph its full width without the two overlapping, wide enough for
 * the sensor panel's status sentences.
 */
export const CONTROL_PANEL_WIDTH = 300;

/** Height of the walking track strip in the play area. */
export const TRACK_HEIGHT = 108;

/** Height of the walker figure, in pixels. */
export const WALKER_HEIGHT = 72;

// ── The recording (SI units) ──────────────────────────────────────────────────

/**
 * Longest recording allowed, in seconds. A logger left running all lesson would
 * grow without bound and outrun the graph's own point buffer; stopping is better
 * than silently dropping the beginning of the motion being watched.
 */
export const MAX_RECORD_DURATION_S = 60;

/**
 * Most points the graph keeps. Comfortably above MAX_RECORD_DURATION_S at the
 * fastest {@link SAMPLE_RATE_CHOICES_HZ} (50 Hz x 60 s = 3001 samples), so the
 * duration cap is what ends a recording, never the buffer.
 */
export const MAX_GRAPH_DATA_POINTS = 3200;

/**
 * Trace sampling rates a student may choose from, in hertz. The model samples
 * the active source on its own fixed clock at the chosen rate, so a recording
 * has the same number of points and the same spacing whether it came from the
 * pointer or from the sensor.
 *
 * The list is bounded at both ends for physical reasons: below 5 Hz a walk is
 * too coarsely sampled for the derivative chain to mean anything, and above
 * 50 Hz the sensor cannot answer every tick — one BLE round trip takes tens of
 * milliseconds — so the trace would repeat stale readings.
 */
export const SAMPLE_RATE_CHOICES_HZ: readonly number[] = [5, 10, 20, 50];

/**
 * Rate a screen starts at, and the one Reset All returns to. Fast enough to
 * follow a walk, slow enough that the sensor keeps up comfortably.
 */
export const DEFAULT_SAMPLE_RATE_HZ = 20;

/**
 * Derived from {@link DEFAULT_SAMPLE_RATE_HZ}; the model's fixed timestep at the default rate.
 * @internal Exported for unit tests; not part of the application API.
 */
export const DEFAULT_SAMPLE_PERIOD_S = 1 / DEFAULT_SAMPLE_RATE_HZ;

/**
 * Span of the trailing windows used to smooth position and to differentiate it
 * into velocity, and velocity into acceleration — expressed in seconds rather
 * than in samples, because the sample rate is now a student's choice. Short
 * enough to follow a real turnaround, long enough to suppress sensor jitter, and
 * the same physical smoothing at 5 Hz as at 50 Hz.
 */
const DERIVATIVE_WINDOW_S = 0.2;

/** Fewest samples a window may span, so a slow rate still fits a straight line. */
const MINIMUM_WINDOW_SAMPLES = 3;

/** Samples spanning {@link DERIVATIVE_WINDOW_S} at `sampleRateHz`, never below {@link MINIMUM_WINDOW_SAMPLES}. */
export function windowSamplesForRate(sampleRateHz: number): number {
  return Math.max(MINIMUM_WINDOW_SAMPLES, Math.round(DERIVATIVE_WINDOW_S * sampleRateHz));
}

// ── The activity area (SI units) ──────────────────────────────────────────────

/**
 * Range of the walking track, in metres. Although the PS-3219 can measure
 * farther, 2 m is a practical maximum walking distance for a classroom
 * activity. The graph scales its own axes to the data; this bounds the track and
 * clamps the sensor, it is not an axis range.
 */
export const POSITION_RANGE_M = new Range(0, 2);

/** Closest distance the PASCO Wireless Motion Sensor (PS-3219) can resolve, in metres. */
export const SENSOR_MINIMUM_RANGE_M = 0.15;

/**
 * Farthest echo accepted in each of the sensor's two range settings, in metres.
 * Long is the device's full 4 m reach; Short is PASCO's recommendation for carts
 * and tracks, where a distant echo is far more likely to be a wall than a
 * target. See {@link SensorRange} for what the setting does here.
 */
export const LONG_RANGE_MAXIMUM_M = 4;
export const SHORT_RANGE_MAXIMUM_M = 2;

/**
 * Bounds on the position the sensor source publishes, in metres. Wider than the
 * track and symmetric about zero, because a student may flip the sign of the
 * reading or zero it from the far end of the room; the track drawing clamps
 * itself, and the graph scales to whatever was recorded.
 */
export const SENSOR_REPORTED_RANGE_M = new Range(-LONG_RANGE_MAXIMUM_M, LONG_RANGE_MAXIMUM_M);

// ── Sensor ────────────────────────────────────────────────────────────────────

/**
 * How often the Motion Sensor screen asks the device for a position, in
 * milliseconds. Faster than the sample period at every rate up to 20 Hz, so a
 * fresh reading is waiting when the model's fixed clock takes its sample; at
 * 50 Hz the link is the limit and some samples repeat the previous reading.
 */
export const DEFAULT_POLL_INTERVAL_MS = 40;

/**
 * Consecutive failed reads tolerated before the source declares an error. A
 * single dropped BLE round trip is normal; ten in a row is not.
 */
export const MAXIMUM_CONSECUTIVE_FAILURES = 10;

/** Human-readable name of the position derived from the raw echo-time sample. */
export const POSITION_MEASUREMENT = "Position";

MotionSensorNamespace.register("MotionSensorConstants", {
  SCREEN_VIEW_MARGIN,
  PANEL_CORNER_RADIUS,
  GRAPH_WIDTH,
  GRAPH_HEIGHT,
  MAX_RECORD_DURATION_S,
  MAX_GRAPH_DATA_POINTS,
  SAMPLE_RATE_CHOICES_HZ,
  DEFAULT_SAMPLE_RATE_HZ,
  DEFAULT_SAMPLE_PERIOD_S,
  DERIVATIVE_WINDOW_S,
  POSITION_RANGE_M,
});
