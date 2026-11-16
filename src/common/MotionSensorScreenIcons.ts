/**
 * MotionSensorScreenIcons.ts
 *
 * Programmatic home-screen / navigation-bar icons for each screen, drawn on the
 * standard PhET 548 × 373 canvas using MotionSensorColors.
 *
 * Both icons show the same recorded curve on the same axes, so the two screens
 * read as the same activity; the sensor screen adds the sensor and its cone to
 * say where the motion comes from. Everything is drawn from ProfileColorProperty
 * values, so the icons follow projector mode, and from fixed numbers, so they
 * are identical on every launch.
 */
import { Shape } from "scenerystack/kite";
import { Circle, Line, Node, Path, Rectangle } from "scenerystack/scenery";
import { ScreenIcon } from "scenerystack/sim";
import MotionSensorColors from "../MotionSensorColors.js";
import { MOTION_SENSOR_SCREEN_ICONS_SETTINGS } from "../MotionSensorConstants.js";

const W = 548;
const H = 373;

/** Inset of the plot area from the icon edge, leaving room for the axes. */
const PLOT_LEFT: number = MOTION_SENSOR_SCREEN_ICONS_SETTINGS.PLOT_LEFT;
const PLOT_RIGHT = W - 40;
const PLOT_TOP: number = MOTION_SENSOR_SCREEN_ICONS_SETTINGS.PLOT_TOP;
const PLOT_BOTTOM = H - 60;

function background(): Rectangle {
  return new Rectangle(0, 0, W, H, { fill: MotionSensorColors.backgroundColorProperty });
}

/** Two axes and a light grid, so the curve reads as a plot rather than a doodle. */
function axesAndGrid(): Node {
  const children: Node[] = [];
  for (let i = 1; i <= 3; i++) {
    const x = PLOT_LEFT + (i * (PLOT_RIGHT - PLOT_LEFT)) / 4;
    children.push(
      new Line(x, PLOT_TOP, x, PLOT_BOTTOM, {
        stroke: MotionSensorColors.chartGridColorProperty,
        lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.AXES_AND_GRID_LINE_WIDTH,
      }),
    );
  }
  for (let i = 1; i <= 2; i++) {
    const y = PLOT_TOP + (i * (PLOT_BOTTOM - PLOT_TOP)) / 3;
    children.push(
      new Line(PLOT_LEFT, y, PLOT_RIGHT, y, {
        stroke: MotionSensorColors.chartGridColorProperty,
        lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.AXES_AND_GRID_LINE_WIDTH,
      }),
    );
  }
  children.push(
    new Line(PLOT_LEFT, PLOT_TOP, PLOT_LEFT, PLOT_BOTTOM, {
      stroke: MotionSensorColors.chartBorderColorProperty,
      lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.AXES_AND_GRID_LINE_WIDTH_VARIANT_2,
    }),
    new Line(PLOT_LEFT, PLOT_BOTTOM, PLOT_RIGHT, PLOT_BOTTOM, {
      stroke: MotionSensorColors.chartBorderColorProperty,
      lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.AXES_AND_GRID_LINE_WIDTH_VARIANT_2,
    }),
  );
  return new Node({ children: children });
}

/**
 * A recorded position-vs-time trace: out, turn around, back. The one shape that
 * says "this is motion someone made" rather than "this is a function".
 */
function tracePath(): Path {
  const shape = new Shape();
  const steps: number = MOTION_SENSOR_SCREEN_ICONS_SETTINGS.STEPS;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = PLOT_LEFT + t * (PLOT_RIGHT - PLOT_LEFT);
    // 4t(1-t) peaks at 1 in the middle: away from the sensor, then back.
    const y = PLOT_BOTTOM - 4 * t * (1 - t) * (PLOT_BOTTOM - PLOT_TOP - 20);
    if (i === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }
  return new Path(shape, {
    stroke: MotionSensorColors.traceColorProperty,
    lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.TRACE_PATH_LINE_WIDTH,
    lineCap: "round",
    lineJoin: "round",
  });
}

function iconFrom(content: Node): ScreenIcon {
  return new ScreenIcon(content, {
    maxIconWidthProportion: 1,
    maxIconHeightProportion: 1,
    fill: MotionSensorColors.backgroundColorProperty,
  });
}

export function createSimulationIcon(): ScreenIcon {
  return iconFrom(
    new Node({
      children: [
        background(),
        axesAndGrid(),
        tracePath(),
        // The cursor that drew it, at the top of the arch.
        new Circle(MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SIMULATION_ICON_RADIUS, {
          fill: MotionSensorColors.walkerColorProperty,
          stroke: MotionSensorColors.backgroundColorProperty,
          lineWidth: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SIMULATION_ICON_LINE_WIDTH,
          centerX: (PLOT_LEFT + PLOT_RIGHT) / 2,
          centerY: PLOT_TOP + MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SIMULATION_ICON_CENTER_Y_OFFSET,
        }),
      ],
    }),
  );
}

export function createSensorIcon(): ScreenIcon {
  return iconFrom(
    new Node({
      children: [
        background(),
        axesAndGrid(),
        tracePath(),
        // The sensor sits outside the plot, with its ultrasound cone opening
        // across it — the reading is what the curve is made of.
        new Path(
          new Shape()
            .moveTo(MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_X, H - 92)
            .lineTo(PLOT_RIGHT, H - 160)
            .lineTo(PLOT_RIGHT, H - 24)
            .close(),
          { fill: MotionSensorColors.sensorBeamColorProperty },
        ),
        new Rectangle(
          MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_X_SEGMENT_2,
          H - 126,
          MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_WIDTH,
          MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_HEIGHT,
          MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_CORNER_X,
          MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_CORNER_Y,
          { fill: MotionSensorColors.sensorBodyColorProperty },
        ),
        new Circle(MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_RADIUS, {
          fill: MotionSensorColors.backgroundColorProperty,
          centerX: MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_CENTER_X,
          centerY: H - MOTION_SENSOR_SCREEN_ICONS_SETTINGS.CREATE_SENSOR_ICON_CENTER_Y_OFFSET,
        }),
      ],
    }),
  );
}
