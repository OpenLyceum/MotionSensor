import { MOTION_SENSOR_PREFERENCES_NODE_SETTINGS } from "../MotionSensorConstants.js";
/**
 * MotionSensorPreferencesNode.ts
 *
 * The Preferences → Simulation tab.
 *
 * One teacher-facing control: raw sensor diagnostics, for hardware bring-up.
 *
 * Note the text colour: the Preferences dialog is always light, whatever colour
 * profile the sim is in, so labels here use `controlSurfaceTextColorProperty`
 * and never `textColorProperty`.
 */

import { Node, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { Checkbox } from "scenerystack/sun";
import type { Tandem } from "scenerystack/tandem";
import { StringManager } from "../i18n/StringManager.js";
import MotionSensorColors from "../MotionSensorColors.js";
import MotionSensorNamespace from "../MotionSensorNamespace.js";
import type { MotionSensorPreferencesModel } from "./MotionSensorPreferencesModel.js";

const LABEL_FONT = new PhetFont(MOTION_SENSOR_PREFERENCES_NODE_SETTINGS.LABEL_FONT_SIZE);
const CONTENT_WIDTH: number = MOTION_SENSOR_PREFERENCES_NODE_SETTINGS.CONTENT_WIDTH;

export class MotionSensorPreferencesNode extends Node {
  public constructor(preferences: MotionSensorPreferencesModel, tandem?: Tandem) {
    const strings = StringManager.getInstance().getPreferences();

    const diagnosticsCheckbox = new Checkbox(
      preferences.showDiagnosticsProperty,
      new Text(strings.showDiagnosticsStringProperty, {
        font: LABEL_FONT,
        fill: MotionSensorColors.controlSurfaceTextColorProperty,
        maxWidth: CONTENT_WIDTH - MOTION_SENSOR_PREFERENCES_NODE_SETTINGS.DIAGNOSTICS_CHECKBOX_MAX_WIDTH_OFFSET,
      }),
      {
        accessibleName: strings.showDiagnosticsStringProperty,
        ...(tandem ? { tandem: tandem.createTandem("diagnosticsCheckbox") } : {}),
      },
    );

    super({
      children: [
        new VBox({
          align: "left",
          spacing: MOTION_SENSOR_PREFERENCES_NODE_SETTINGS.CONSTRUCTOR_SPACING,
          children: [diagnosticsCheckbox],
        }),
      ],
    });
  }
}

MotionSensorNamespace.register("MotionSensorPreferencesNode", MotionSensorPreferencesNode);
