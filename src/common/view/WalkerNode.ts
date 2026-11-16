import { WALKER_NODE_SETTINGS } from "../../MotionSensorConstants.js";
/**
 * WalkerNode.ts
 *
 * The figure on the track. On the Simulation screen the student drags it; on
 * the Motion Sensor screen it follows the sensor and cannot be grabbed.
 *
 * Drawn rather than loaded from an image: the sim ships no art, so there is no
 * asset pipeline and no third-party licence to track, and the figure recolours
 * with the projector profile for free.
 */

import type { TReadOnlyProperty } from "scenerystack/axon";
import { Shape } from "scenerystack/kite";
import { Circle, Node, Path } from "scenerystack/scenery";
import MotionSensorColors from "../../MotionSensorColors.js";
import { WALKER_HEIGHT } from "../../MotionSensorConstants.js";

/** Proportions of the figure, as fractions of WALKER_HEIGHT. */
const HEAD_RADIUS: number = WALKER_NODE_SETTINGS.HEAD_RADIUS;
const SHOULDER_Y: number = WALKER_NODE_SETTINGS.SHOULDER_Y;
const HIP_Y: number = WALKER_NODE_SETTINGS.HIP_Y;
const ARM_SPAN: number = WALKER_NODE_SETTINGS.ARM_SPAN;
const LEG_SPAN: number = WALKER_NODE_SETTINGS.LEG_SPAN;

export type WalkerNodeOptions = {
  /** Accessible name for the figure. */
  readonly accessibleName: TReadOnlyProperty<string>;
  /** Accessible help text describing how (or whether) it moves. */
  readonly accessibleHelpText: TReadOnlyProperty<string>;
  /** True on the Simulation screen, where the figure is the input device. */
  readonly draggable: boolean;
  /** Hides the figure when there is no position to show it at. */
  readonly visibleProperty?: TReadOnlyProperty<boolean>;
};

export class WalkerNode extends Node {
  public constructor(providedOptions: WalkerNodeOptions) {
    const height = WALKER_HEIGHT;

    const head = new Circle(HEAD_RADIUS * height, {
      fill: MotionSensorColors.walkerColorProperty,
      centerY: HEAD_RADIUS * height,
    });

    // Body, arms and legs as one stroked path: a single Node to recolour, and
    // the joints line up by construction.
    const body = new Shape()
      .moveTo(0, SHOULDER_Y * height - 0.06 * height)
      .lineTo(0, HIP_Y * height)
      // arms
      .moveTo(-ARM_SPAN * height, SHOULDER_Y * height + 0.12 * height)
      .lineTo(0, SHOULDER_Y * height)
      .lineTo(ARM_SPAN * height, SHOULDER_Y * height + 0.12 * height)
      // legs
      .moveTo(-LEG_SPAN * height, height)
      .lineTo(0, HIP_Y * height)
      .lineTo(LEG_SPAN * height, height);

    const limbs = new Path(body, {
      stroke: MotionSensorColors.walkerColorProperty,
      lineWidth: WALKER_NODE_SETTINGS.LIMBS_LINE_WIDTH_FACTOR * height,
      lineCap: "round",
      lineJoin: "round",
    });

    super({
      children: [head, limbs],
      cursor: providedOptions.draggable ? "ew-resize" : null,
      // A plain Node needs to be told it is interactive; sun controls do this
      // for themselves, this one does not.
      ...(providedOptions.draggable ? { tagName: "div", focusable: true } : {}),
      accessibleName: providedOptions.accessibleName,
      accessibleHelpText: providedOptions.accessibleHelpText,
      ...(providedOptions.visibleProperty ? { visibleProperty: providedOptions.visibleProperty } : {}),
    });
  }
}
