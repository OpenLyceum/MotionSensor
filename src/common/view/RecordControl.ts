/**
 * RecordControl.ts
 *
 * Record, Stop, Clear, and the elapsed-time readout.
 *
 * Record and Stop are two separate buttons that swap places rather than one
 * button that changes its label. A control whose accessible name changes under
 * the user is disorienting, and a student reaching for "Stop" should not find it
 * where "Record" was a moment ago and press the wrong thing.
 *
 * Clear stays visible but disabled while there is nothing to clear, so the
 * control set does not reflow as the recording moves through its states.
 *
 * The sample-rate chooser lives here rather than in a panel of its own because
 * it is a property of the recording, not of the display. It is disabled while a
 * recording runs: the rate is captured when Record is pressed, and a control
 * that appears to work but changes nothing until next time is worse than one
 * that plainly cannot be used yet.
 */

import { DerivedProperty, PatternStringProperty } from "scenerystack/axon";
import { toFixed } from "scenerystack/dot";
import { HBox, type Node, RichText, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { ComboBox, RectangularPushButton } from "scenerystack/sun";
import { FLAT_PANEL_PUSH_BUTTON_OPTIONS, LIGHT_SURFACE_TEXT_FILL } from "../../common/MotionSensorButtonOptions.js";
import { MotionSensorPanel } from "../../common/MotionSensorPanel.js";
import type { ScreenA11yStrings } from "../../i18n/StringManager.js";
import { StringManager } from "../../i18n/StringManager.js";
import MotionSensorColors from "../../MotionSensorColors.js";
import { CONTROL_PANEL_WIDTH, SAMPLE_RATE_CHOICES_HZ } from "../../MotionSensorConstants.js";
import type { MotionSensorModel } from "../model/MotionSensorModel.js";
import { PositionSourceType } from "../model/PositionSource.js";
import { RunState } from "../model/RunState.js";

const BUTTON_FONT = new PhetFont(15);
const LABEL_FONT = new PhetFont(12);
const TIME_FONT = new PhetFont({ size: 26, weight: "bold" });
const MESSAGE_FONT = new PhetFont(14);

/** Decimal places on the elapsed-time readout — one tenth of a second is legible; two is noise. */
const TIME_DECIMALS = 1;

export class RecordControl extends MotionSensorPanel {
  /** Exposed so the ScreenView can order them in the PDOM. */
  public readonly recordButton: RectangularPushButton;
  public readonly stopButton: RectangularPushButton;
  public readonly clearButton: RectangularPushButton;
  public readonly sampleRateComboBox: ComboBox<number>;

  private readonly disposeRecordControl: () => void;

  /** @param listParent - where the sample-rate combo box's popup goes, above everything else */
  public constructor(model: MotionSensorModel, a11y: ScreenA11yStrings, listParent: Node) {
    const runStrings = StringManager.getInstance().getRunStrings();

    const isRecordingProperty = new DerivedProperty([model.runStateProperty], (state) => state === RunState.RECORDING);
    const isIdleProperty = new DerivedProperty([model.runStateProperty], (state) => state !== RunState.RECORDING);
    const hasRecordingProperty = new DerivedProperty([model.runStateProperty], (state) => state === RunState.STOPPED);

    const recordButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(runStrings.recordStringProperty, { font: BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
      listener: () => model.startRecording(),
      accessibleName: a11y.controls.recordButtonStringProperty,
      visibleProperty: isIdleProperty,
      enabledProperty: model.canRecordProperty,
    });

    const stopButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(runStrings.stopStringProperty, { font: BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
      listener: () => model.stopRecording(),
      accessibleName: a11y.controls.stopButtonStringProperty,
      visibleProperty: isRecordingProperty,
    });

    const clearButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(runStrings.clearStringProperty, { font: BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
      listener: () => model.clearRun(),
      accessibleName: a11y.controls.clearButtonStringProperty,
      enabledProperty: hasRecordingProperty,
    });

    // One item per allowed rate, each label built from the same "{{rate}} Hz"
    // pattern so a locale that writes units differently only has to say so once.
    const rateLabelProperties: { dispose(): void }[] = [];
    const rateItems = SAMPLE_RATE_CHOICES_HZ.map((rate) => {
      const labelProperty = new PatternStringProperty(runStrings.sampleRatePatternStringProperty, { rate: rate });
      rateLabelProperties.push(labelProperty);
      return {
        value: rate,
        createNode: () => new Text(labelProperty, { font: LABEL_FONT, fill: MotionSensorColors.textColorProperty }),
      };
    });
    const sampleRateComboBox = new ComboBox(model.sampleRateProperty, rateItems, listParent, {
      cornerRadius: 4,
      xMargin: 6,
      yMargin: 3,
      buttonFill: MotionSensorColors.panelBackgroundColorProperty,
      buttonStroke: MotionSensorColors.panelBorderColorProperty,
      listFill: MotionSensorColors.panelBackgroundColorProperty,
      listStroke: MotionSensorColors.panelBorderColorProperty,
      highlightFill: MotionSensorColors.panelBorderColorProperty,
      accessibleName: runStrings.sampleRateStringProperty,
      enabledProperty: isIdleProperty,
    });
    const sampleRateRow = new HBox({
      spacing: 8,
      children: [
        new Text(runStrings.sampleRateStringProperty, {
          font: LABEL_FONT,
          fill: MotionSensorColors.textColorProperty,
          maxWidth: CONTROL_PANEL_WIDTH - 140,
        }),
        sampleRateComboBox,
      ],
    });

    // The readout carries its unit, so the number is never alone on screen.
    const elapsedValueProperty = new DerivedProperty([model.timeProperty], (time) => toFixed(time, TIME_DECIMALS));
    const elapsedProperty = new PatternStringProperty(runStrings.elapsedPatternStringProperty, {
      time: elapsedValueProperty,
    });
    const elapsedText = new Text(elapsedProperty, {
      font: TIME_FONT,
      fill: MotionSensorColors.accentColorProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });

    // Only the sensor screen can be unable to record, and only for one reason:
    // nothing is connected yet. Saying so beats a disabled button with no
    // explanation.
    const needsSensorProperty = new DerivedProperty(
      [model.source.isAvailableProperty],
      (available) => model.sourceType === PositionSourceType.MOTION_SENSOR && !available,
    );
    const connectFirstText = new RichText(runStrings.connectFirstStringProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: needsSensorProperty,
      align: "center",
      lineWrap: CONTROL_PANEL_WIDTH - 40,
    });

    // A recording's clock starts at the sensor's first reading, and a sensor
    // with nothing in range to echo off never gives one. Without this the
    // readout would sit at 0.0 s under a Stop button and look broken.
    const waitingText = new RichText(runStrings.waitingForReadingStringProperty, {
      font: MESSAGE_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: model.awaitingFirstReadingProperty,
      align: "center",
      lineWrap: CONTROL_PANEL_WIDTH - 40,
    });

    super(
      new VBox({
        align: "center",
        spacing: 10,
        preferredWidth: CONTROL_PANEL_WIDTH - 24,
        stretch: false,
        children: [
          elapsedText,
          new HBox({ spacing: 10, children: [recordButton, stopButton, clearButton] }),
          sampleRateRow,
          connectFirstText,
          waitingText,
        ],
      }),
      { minWidth: CONTROL_PANEL_WIDTH },
    );

    this.recordButton = recordButton;
    this.stopButton = stopButton;
    this.clearButton = clearButton;

    this.sampleRateComboBox = sampleRateComboBox;

    this.disposeRecordControl = () => {
      sampleRateComboBox.dispose();
      for (const property of [
        isRecordingProperty,
        isIdleProperty,
        hasRecordingProperty,
        elapsedProperty,
        elapsedValueProperty,
        needsSensorProperty,
        ...rateLabelProperties,
      ]) {
        property.dispose();
      }
    };
  }

  public override dispose(): void {
    this.disposeRecordControl();
    super.dispose();
  }
}
