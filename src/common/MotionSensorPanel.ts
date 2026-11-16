import { MOTION_SENSOR_PANEL_SETTINGS } from "../MotionSensorConstants.js";
/**
 * MotionSensorPanel.ts
 *
 * A pre-themed Panel that automatically uses MotionSensorColors for background and
 * border. Use this for all control panels and info boxes in the sim so that
 * default / projector mode switching is handled automatically.
 *
 * ── Basic usage ───────────────────────────────────────────────────────────────
 *
 *   import { MotionSensorPanel } from "../../common/MotionSensorPanel.js";
 *   import { VBox, Text } from "scenerystack/scenery";
 *
 *   const content = new VBox({
 *     children: [ new Text("label"), slider ],
 *     spacing: 8,
 *   });
 *   const panel = new MotionSensorPanel(content);
 *
 * ── Overriding defaults ───────────────────────────────────────────────────────
 *
 *   // Wider margins, sharper corners, custom stroke
 *   const panel = new MotionSensorPanel(content, { xMargin: 20, cornerRadius: 0 });
 *
 *   // Transparent background (decorative border only)
 *   const panel = new MotionSensorPanel(content, { fill: "transparent" });
 */

import { type EmptySelfOptions, optionize } from "scenerystack/phet-core";
import type { Node } from "scenerystack/scenery";
import { Panel, type PanelOptions } from "scenerystack/sun";
import MotionSensorColors from "../MotionSensorColors.js";
import { PANEL_CORNER_RADIUS } from "../MotionSensorConstants.js";

export type MotionSensorPanelOptions = PanelOptions;

export class MotionSensorPanel extends Panel {
  public constructor(content: Node, providedOptions?: MotionSensorPanelOptions) {
    const options = optionize<MotionSensorPanelOptions, EmptySelfOptions, PanelOptions>()(
      {
        fill: MotionSensorColors.panelBackgroundColorProperty,
        stroke: MotionSensorColors.panelBorderColorProperty,
        cornerRadius: PANEL_CORNER_RADIUS,
        xMargin: MOTION_SENSOR_PANEL_SETTINGS.OPTIONS_X_MARGIN,
        yMargin: MOTION_SENSOR_PANEL_SETTINGS.OPTIONS_Y_MARGIN,
      },
      providedOptions,
    );
    super(content, options);
  }
}
