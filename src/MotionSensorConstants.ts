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

/** Settings for common/MotionSensorControlOptions.ts. */
export const MOTION_SENSOR_CONTROL_OPTIONS_SETTINGS = {
  /** Checkbox box width (px). */
  CHECKBOX_BOX_WIDTH: 16,
  /** Sim checkbox options spacing (px). */
  SIM_CHECKBOX_OPTIONS_SPACING: 4,
} as const;

/** Settings for common/MotionSensorPanel.ts. */
export const MOTION_SENSOR_PANEL_SETTINGS = {
  /** Options x margin (px). */
  OPTIONS_X_MARGIN: 12,
  /** Options y margin (px). */
  OPTIONS_Y_MARGIN: 10,
} as const;

/** Settings for common/MotionSensorScreenIcons.ts. */
export const MOTION_SENSOR_SCREEN_ICONS_SETTINGS = {
  CREATE_SIMULATION_ICON_CENTER_Y_OFFSET: 20, // px
  CREATE_SENSOR_ICON_CENTER_Y_OFFSET: 92, // px

  AXES_AND_GRID_LINE_WIDTH_VARIANT_2: 6, // px
  CREATE_SENSOR_ICON_X_SEGMENT_2: 20, // px

  /** Inset of the plot area from the icon edge, leaving room for the axes. */
  PLOT_LEFT: 74,
  /** Plot top (px). */
  PLOT_TOP: 40,
  /** Axes and grid line width (px). */
  AXES_AND_GRID_LINE_WIDTH: 3,
  /** Steps (count). */
  STEPS: 48,
  /** Trace path line width (px). */
  TRACE_PATH_LINE_WIDTH: 14,
  /** Create simulation icon radius (px). */
  CREATE_SIMULATION_ICON_RADIUS: 17,
  /** Create simulation icon line width (px). */
  CREATE_SIMULATION_ICON_LINE_WIDTH: 5,
  /** Create sensor icon x (px). */
  CREATE_SENSOR_ICON_X: 56,
  /** Create sensor icon width (px). */
  CREATE_SENSOR_ICON_WIDTH: 46,
  /** Create sensor icon height (px). */
  CREATE_SENSOR_ICON_HEIGHT: 68,
  /** Create sensor icon corner x (px). */
  CREATE_SENSOR_ICON_CORNER_X: 8,
  /** Create sensor icon corner y (px). */
  CREATE_SENSOR_ICON_CORNER_Y: 8,
  /** Create sensor icon radius (px). */
  CREATE_SENSOR_ICON_RADIUS: 14,
  /** Create sensor icon center x (px). */
  CREATE_SENSOR_ICON_CENTER_X: 43,
} as const;

/** Settings for common/model/MotionSensorModel.ts. */
export const MOTION_SENSOR_MODEL_SETTINGS = {
  /** A dt larger than this is a tab that was backgrounded, not a slow frame. Clamping stops the accumulator from firing hundreds of catch-up samples and recording a flat line for time the student was not actually there for. */
  MAXIMUM_DT_S: 0.25,
  /** Slack for the accumulator comparison. A whole number of period-sized ticks does not sum to a whole number in binary, and without this the loop would occasionally hold a sample back for one extra frame. */
  TIME_EPSILON_S: 1e-9,
} as const;

/** Settings for common/model/SensorPositionSource.ts. */
export const SENSOR_POSITION_SOURCE_SETTINGS = {
  /** How long a stream may say nothing before the recording gives up on it. Long enough to cover a slow first sample, short enough that a short recording still gets a trace. */
  STREAM_SILENCE_TIMEOUT_MS: 1000,
  /** Sample periods of silence tolerated, so a period raised with `?pollIntervalMs=` is not mistaken for a dead stream. */
  STREAM_SILENCE_PERIODS: 5,
} as const;

/** Settings for common/util/GraphAnnouncer.ts. */
export const GRAPH_ANNOUNCER_SETTINGS = {
  /** Milliseconds of quiet required before an axis change is spoken. Long enough to swallow a run of rapid selections, short enough not to feel laggy. */
  GRAPH_CHANGE_ANNOUNCEMENT_DELAY: 200,
} as const;

/** Settings for common/view/DataTableNode.ts. */
export const DATA_TABLE_NODE_SETTINGS = {
  FOOTER_MAX_WIDTH_OFFSET: 70, // px

  ITEM_2_SPACING: 3, // px
  ITEM_3_SPACING: 6, // px

  /** Header font size (px). */
  HEADER_FONT_SIZE: 11,
  /** Cell font size (px). */
  CELL_FONT_SIZE: 11,
  /** Combo box font size (px). */
  COMBO_BOX_FONT_SIZE: 11,
  /** Footer font size (px). */
  FOOTER_FONT_SIZE: 10,
  /** Button font size (px). */
  BUTTON_FONT_SIZE: 11,
  /** Scroll button font size (px). */
  SCROLL_BUTTON_FONT_SIZE: 11,
  /** Rows on screen at once. Enough to see a turnaround, and chosen so the panel fits inside the graph's plot area rather than hanging over its tick labels; the rest of a recording is a scroll — or a download — away. */
  VISIBLE_ROWS: 10,
  /** Row height (px). */
  ROW_HEIGHT: 17,
  /** Column width (px). */
  COLUMN_WIDTH: 84,
  /** Column gap (px). */
  COLUMN_GAP: 12,
  /** Rows moved by one press of a scroll button, or one notch of the wheel. */
  SCROLL_STEP_ROWS: 3,
  /** Decimals in every cell and in the CSV. Three is a millimetre — past any sensor's honesty. */
  VALUE_DECIMALS: 3,
  /** Create combo box corner radius (px). */
  CREATE_COMBO_BOX_CORNER_RADIUS: 4,
  /** Create combo box x margin (px). */
  CREATE_COMBO_BOX_X_MARGIN: 5,
  /** Create combo box y margin (px). */
  CREATE_COMBO_BOX_Y_MARGIN: 2,
  /** Create scroll button x margin (px). */
  CREATE_SCROLL_BUTTON_X_MARGIN: 7,
  /** Create scroll button y margin (px). */
  CREATE_SCROLL_BUTTON_Y_MARGIN: 3,
  /** Constructor spacing (px). */
  CONSTRUCTOR_SPACING: 7,
  /** Constructor x margin (px). */
  CONSTRUCTOR_X_MARGIN: 10,
  /** Constructor y margin (px). */
  CONSTRUCTOR_Y_MARGIN: 8,
} as const;

/** Settings for common/view/MotionSensorScreenView.ts. */
export const MOTION_SENSOR_SCREEN_VIEW_SETTINGS = {
  CONSTRUCTOR_LEFT_OFFSET: 44, // px
  CONSTRUCTOR_TOP_OFFSET: 24, // px

  /** Label font size (px). */
  LABEL_FONT_SIZE: 12,
  /** Width of the track beneath the graph. */
  PLAY_AREA_WIDTH: 560,
  /** Height of the graph's own header bar, which is part of its bounds and sits above the plot. The table clears it rather than covering the axis pickers. */
  GRAPH_HEADER_HEIGHT: 30,
  /** Gap between the data table and the graph's edges, in pixels. */
  TABLE_INSET: 10,
  /** View control spacing (px). */
  VIEW_CONTROL_SPACING: 7,
  /** Control column spacing (px). */
  CONTROL_COLUMN_SPACING: 14,
  /** Create checkbox max width (px). */
  CREATE_CHECKBOX_MAX_WIDTH: 300,
} as const;

/** Settings for common/view/PlayAreaNode.ts. */
export const PLAY_AREA_NODE_SETTINGS = {
  CONSTRUCTOR_TOP_OFFSET: 10, // px
  SENSOR_BODY_Y_OFFSET: 14, // px

  /** Tick label font size (px). */
  TICK_LABEL_FONT_SIZE: 10,
  /** Pixels reserved at each end so the figure stays on the track at either limit. */
  EDGE_INSET: 26,
  /** Track corner x (px). */
  TRACK_CORNER_X: 6,
  /** Track corner y (px). */
  TRACK_CORNER_Y: 6,
  /** Sensor body x (px). */
  SENSOR_BODY_X: -10,
  /** Sensor body y (px). */
  SENSOR_BODY_Y: -14,
  /** Sensor body width (px). */
  SENSOR_BODY_WIDTH: 20,
  /** Sensor body height (px). */
  SENSOR_BODY_HEIGHT: 28,
  /** Sensor body corner x (px). */
  SENSOR_BODY_CORNER_X: 3,
  /** Sensor body corner y (px). */
  SENSOR_BODY_CORNER_Y: 3,
} as const;

/** Settings for common/view/RecordControl.ts. */
export const RECORD_CONTROL_SETTINGS = {
  SAMPLE_RATE_ROW_MAX_WIDTH_OFFSET: 140, // px
  ELAPSED_TEXT_MAX_WIDTH_OFFSET: 40, // px
  CONNECT_FIRST_TEXT_LINE_WRAP_OFFSET: 40, // px
  WAITING_TEXT_LINE_WRAP_OFFSET: 40, // px

  /** Button font size (px). */
  BUTTON_FONT_SIZE: 15,
  /** Label font size (px). */
  LABEL_FONT_SIZE: 12,
  /** Time font size (px). */
  TIME_FONT_SIZE: 26,
  /** Message font size (px). */
  MESSAGE_FONT_SIZE: 14,
  /** Sample rate combo box corner radius (px). */
  SAMPLE_RATE_COMBO_BOX_CORNER_RADIUS: 4,
  /** Sample rate combo box x margin (px). */
  SAMPLE_RATE_COMBO_BOX_X_MARGIN: 6,
  /** Sample rate combo box y margin (px). */
  SAMPLE_RATE_COMBO_BOX_Y_MARGIN: 3,
  /** Sample rate row spacing (px). */
  SAMPLE_RATE_ROW_SPACING: 8,
  /** Constructor spacing (px). */
  CONSTRUCTOR_SPACING: 10,
} as const;

/** Settings for common/view/SensorOptionsPanel.ts. */
export const SENSOR_OPTIONS_PANEL_SETTINGS = {
  CHANGE_SIGN_CHECKBOX_MAX_WIDTH_OFFSET: 60, // px
  ZERO_AT_START_CHECKBOX_MAX_WIDTH_OFFSET: 60, // px
  OFFSET_TEXT_MAX_WIDTH_OFFSET: 40, // px
  CONSTRUCTOR_MAX_WIDTH_OFFSET: 40, // px

  ITEM_4_SPACING: 6, // px

  /** Title font size (px). */
  TITLE_FONT_SIZE: 13,
  /** Label font size (px). */
  LABEL_FONT_SIZE: 12,
  /** Button font size (px). */
  BUTTON_FONT_SIZE: 12,
  /** Readout font size (px). */
  READOUT_FONT_SIZE: 11,
  /** Decimals on the zero-offset readout; a millimetre is finer than the sensor resolves. */
  OFFSET_DECIMALS: 3,
  /** Range combo box corner radius (px). */
  RANGE_COMBO_BOX_CORNER_RADIUS: 4,
  /** Range combo box x margin (px). */
  RANGE_COMBO_BOX_X_MARGIN: 6,
  /** Range combo box y margin (px). */
  RANGE_COMBO_BOX_Y_MARGIN: 3,
  /** Constructor spacing (px). */
  CONSTRUCTOR_SPACING: 8,
} as const;

/** Settings for common/view/SensorPanel.ts. */
export const SENSOR_PANEL_SETTINGS = {
  STATUS_ROW_MAX_WIDTH_OFFSET: 60, // px
  DEVICE_NAME_TEXT_MAX_WIDTH_OFFSET: 40, // px
  ERROR_TEXT_LINE_WRAP_OFFSET: 40, // px
  UNAVAILABLE_TEXT_LINE_WRAP_OFFSET: 40, // px
  DIAGNOSTICS_TEXT_MAX_WIDTH_OFFSET: 40, // px
  MEASUREMENT_LIST_TEXT_MAX_WIDTH_OFFSET: 40, // px
  RAW_READING_TEXT_MAX_WIDTH_OFFSET: 40, // px

  /** Label font size (px). */
  LABEL_FONT_SIZE: 13,
  /** Message font size (px). */
  MESSAGE_FONT_SIZE: 12,
  /** Status dot radius (px). */
  STATUS_DOT_RADIUS: 5,
  /** Status row spacing (px). */
  STATUS_ROW_SPACING: 8,
  /** Constructor spacing (px). */
  CONSTRUCTOR_SPACING: 8,
} as const;

/** Settings for common/view/WalkerNode.ts. */
export const WALKER_NODE_SETTINGS = {
  LIMBS_LINE_WIDTH_FACTOR: 0.07, // dimensionless

  /** Proportions of the figure, as fractions of WALKER_HEIGHT. */
  HEAD_RADIUS: 0.13,
  /** Shoulder height as a fraction of WALKER_HEIGHT. */
  SHOULDER_Y: 0.3,
  /** Hip height as a fraction of WALKER_HEIGHT. */
  HIP_Y: 0.62,
  /** Half-width of the arm span as a fraction of WALKER_HEIGHT. */
  ARM_SPAN: 0.16,
  /** Half-width of the stance as a fraction of WALKER_HEIGHT. */
  LEG_SPAN: 0.15,
} as const;

/** Settings for common/view/graph/ConfigurableGraph.ts. */
export const CONFIGURABLE_GRAPH_SETTINGS = {
  RESIZE_GRAPH_TOP_OFFSET: 35, // px

  /** Grid line width (px). */
  GRID_LINE_WIDTH: 0.5,
  /** Plot line width (px). */
  PLOT_LINE_WIDTH: 2,
  /** Tick extent (px). */
  TICK_EXTENT: 8,
  /** Tick label font size (px). */
  TICK_LABEL_FONT_SIZE: 10,
  /** Decimal places on axis tick labels (digits). */
  TICK_LABEL_DECIMALS: 2,
  /** Axis label font size (px). */
  AXIS_LABEL_FONT_SIZE: 12,
  /** Axis label offset (px). */
  AXIS_LABEL_OFFSET: 35,
  /** Y axis interaction width (px). */
  Y_AXIS_INTERACTION_WIDTH: 60,
  /** X axis interaction height (px). */
  X_AXIS_INTERACTION_HEIGHT: 30,
  /** Button size (px). */
  BUTTON_SIZE: 24,
  /** Button padding (px). */
  BUTTON_PADDING: 4,
  /** Button spacing (px). */
  BUTTON_SPACING: 2,
  /** Button corner radius (px). */
  BUTTON_CORNER_RADIUS: 3,
  /** Button font size (px). */
  BUTTON_FONT_SIZE: 14,
  /** Button hover opacity (dimensionless). */
  BUTTON_HOVER_OPACITY: 0.8,
  /** Title bottom offset (px). */
  TITLE_BOTTOM_OFFSET: -5,
  /** Default maximum samples retained on the graph (count). */
  DEFAULT_MAX_DATA_POINTS: 2000,
  /** Initial range min (control/model units). */
  INITIAL_RANGE_MIN: -10,
  /** Initial range max (control/model units). */
  INITIAL_RANGE_MAX: 10,
  /** Default button-background opacity when not hovered (dimensionless). */
  OPACITY: 1.0,
  /** Axis interaction width (px). */
  AXIS_INTERACTION_WIDTH: 60,
  /** Axis interaction height (px). */
  AXIS_INTERACTION_HEIGHT: 30,
} as const;

/** Settings for common/view/graph/GraphControlsPanel.ts. */
export const GRAPH_CONTROLS_PANEL_SETTINGS = {
  /** Combo box font size (px). */
  COMBO_BOX_FONT_SIZE: 12,
  /** Title font size (px). */
  TITLE_FONT_SIZE: 14,
  /** Combo box corner radius (px). */
  COMBO_BOX_CORNER_RADIUS: 5,
  /** Combo box x margin (px). */
  COMBO_BOX_X_MARGIN: 6,
  /** Combo box y margin (px). */
  COMBO_BOX_Y_MARGIN: 3,
  /** Title spacing (px). */
  TITLE_SPACING: 3,
  /** Header height (px). */
  HEADER_HEIGHT: 30,
  /** Header corner radius (px). */
  HEADER_CORNER_RADIUS: 5,
  /** Header line width (px). */
  HEADER_LINE_WIDTH: 2,
  /** Header darken factor (dimensionless). */
  HEADER_DARKEN_FACTOR: 0.1,
} as const;

/** Settings for common/view/graph/GraphDataManager.ts. */
export const GRAPH_DATA_MANAGER_SETTINGS = {
  /** Trail min radius (px). */
  TRAIL_MIN_RADIUS: 3,
  /** Trail max radius (px). */
  TRAIL_MAX_RADIUS: 5,
  /** Trail min opacity (dimensionless). */
  TRAIL_MIN_OPACITY: 0.2,
  /** Trail max opacity (dimensionless). */
  TRAIL_MAX_OPACITY: 0.8,
  /** Default range min (control/model units). */
  DEFAULT_RANGE_MIN: -10,
  /** Default range max (control/model units). */
  DEFAULT_RANGE_MAX: 10,
} as const;

/** Settings for common/view/graph/GraphInteractionHandler.ts. */
export const GRAPH_INTERACTION_HANDLER_SETTINGS = {
  /** Handle size (px). */
  HANDLE_SIZE: 12,
  /** Handle offset (px). */
  HANDLE_OFFSET: -6,
  /** Handle corner x (px). */
  HANDLE_CORNER_X: 2,
  /** Handle corner y (px). */
  HANDLE_CORNER_Y: 2,
  /** Handle line width (px). */
  HANDLE_LINE_WIDTH: 2,
  /** Min width (px). */
  MIN_WIDTH: 200,
  /** Min height (px). */
  MIN_HEIGHT: 150,
} as const;

/** Settings for preferences/MotionSensorPreferencesNode.ts. */
export const MOTION_SENSOR_PREFERENCES_NODE_SETTINGS = {
  DIAGNOSTICS_CHECKBOX_MAX_WIDTH_OFFSET: 40, // px

  /** Label font size (px). */
  LABEL_FONT_SIZE: 14,
  /** Content width (px). */
  CONTENT_WIDTH: 440,
  /** Constructor spacing (px). */
  CONSTRUCTOR_SPACING: 12,
} as const;

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
