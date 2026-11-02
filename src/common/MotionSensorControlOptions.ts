/**
 * MotionSensorControlOptions.ts
 *
 * Shared chrome for panel controls. Import these instead of repeating colour and
 * sizing values in each view.
 *
 * Template-owned toolkit: each sim uses only some of these, so every export is tagged
 * `@public` to tell dead-code checkers (knip) that an unused one is not dead code.
 */

import type { CheckboxOptions } from "scenerystack/sun";
import MotionSensorColors from "../MotionSensorColors.js";

const CHECKBOX_BOX_WIDTH = 16;

/**
 * Themed checkbox chrome on dark panel backgrounds.
 *
 * The box fill matches the panel so the control reads as part of the panel, and
 * the tick/border use {@link MotionSensorColors.textColorProperty} (near-white in
 * default mode). Do not use {@link MotionSensorColors.controlSurfaceColorProperty}
 * here — that colour is for white chrome (push buttons, combo lists, Preferences).
 *
 * @public
 */
export const SIM_CHECKBOX_OPTIONS = {
  boxWidth: CHECKBOX_BOX_WIDTH,
  spacing: 4,
  checkboxColor: MotionSensorColors.textColorProperty,
  checkboxColorBackground: MotionSensorColors.panelBackgroundColorProperty,
} satisfies CheckboxOptions;
