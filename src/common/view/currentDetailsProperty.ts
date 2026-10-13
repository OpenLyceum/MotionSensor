/**
 * currentDetailsProperty.ts
 *
 * The live sentence a screen reader hears in the screen summary: what the
 * recording is doing right now.
 *
 * Each state gets its own whole localized sentence rather than being assembled
 * from fragments. Word order, agreement and punctuation differ between
 * languages, and a sentence stitched together at runtime is correct only in the
 * language it was stitched for.
 */

import type { TReadOnlyProperty } from "scenerystack/axon";
import { DerivedProperty, PatternStringProperty } from "scenerystack/axon";
import { type ScreenA11yStrings, StringManager } from "../../i18n/StringManager.js";
import type { MotionSensorModel } from "../model/MotionSensorModel.js";
import { PositionSourceType } from "../model/PositionSource.js";
import { RunState } from "../model/RunState.js";

export type CurrentDetails = {
  readonly property: TReadOnlyProperty<string>;
  readonly dispose: () => void;
};

export function createCurrentDetailsProperty(model: MotionSensorModel, a11y: ScreenA11yStrings): CurrentDetails {
  // Spoken time is rounded to whole seconds: a screen reader announcing a tenth
  // of a second twenty times a second is unusable.
  const wholeSecondsProperty = new DerivedProperty([model.timeProperty], (time) => Math.round(time));

  const recordingProperty = new PatternStringProperty(a11y.currentDetails.recordingStringProperty, {
    time: wholeSecondsProperty,
  });
  const stoppedProperty = new PatternStringProperty(a11y.currentDetails.stoppedStringProperty, {
    time: wholeSecondsProperty,
  });

  const property = new DerivedProperty(
    [
      model.runStateProperty,
      model.awaitingFirstReadingProperty,
      model.source.isAvailableProperty,
      a11y.currentDetails.readyStringProperty,
      recordingProperty,
      stoppedProperty,
      a11y.currentDetails.waitingForSensorStringProperty,
      // The visible message is already a whole sentence, so it is spoken as is.
      StringManager.getInstance().getRunStrings().waitingForReadingStringProperty,
    ],
    (state, awaitingFirstReading, available, ready, recording, stopped, waiting, waitingForReading) => {
      // On the sensor screen, "ready to record" is untrue until something is
      // connected; say what is actually blocking instead.
      if (!available && model.sourceType === PositionSourceType.MOTION_SENSOR) {
        return waiting;
      }
      switch (state) {
        case RunState.RECORDING:
          return awaitingFirstReading ? waitingForReading : recording;
        case RunState.STOPPED:
          return stopped;
        default:
          return ready;
      }
    },
  );

  return {
    property: property,
    dispose: () => {
      property.dispose();
      stoppedProperty.dispose();
      recordingProperty.dispose();
      wholeSecondsProperty.dispose();
    },
  };
}
