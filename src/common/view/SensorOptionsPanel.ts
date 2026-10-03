/**
 * SensorOptionsPanel.ts
 *
 * The Motion Sensor screen's measurement settings: the same four adjustments
 * PASCO's own software puts on a motion sensor's properties sheet — change sign,
 * zero at start, zero now / remove the zero offset, and the range.
 *
 * They are grouped in their own panel rather than mixed into the connection
 * panel because they answer a different question. The connection panel is about
 * whether there is a sensor; this one is about what its numbers mean.
 *
 * Every one of them is applied on the host, in {@link SensorPositionSource} —
 * see {@link SensorRange} for why the range is a filter here rather than a
 * command to the device.
 *
 * Change sign, zero now and remove zero are locked while a recording runs. Each
 * moves every reading after it at once, so mid-run it would put a step into
 * the trace — a jump in position and a spike in velocity and acceleration that
 * no one walked. Zero at start (which only arms the next run) and the range (a
 * filter on which echoes to believe, not a shift) stay available.
 */

import {
  type BooleanProperty,
  DerivedProperty,
  PatternStringProperty,
  type TReadOnlyProperty,
} from "scenerystack/axon";
import { toFixed } from "scenerystack/dot";
import type { Node } from "scenerystack/scenery";
import { HBox, Text, VBox } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { Checkbox, ComboBox, RectangularPushButton } from "scenerystack/sun";
import { StringManager } from "../../i18n/StringManager.js";
import MotionSensorColors from "../../MotionSensorColors.js";
import { CONTROL_PANEL_WIDTH } from "../../MotionSensorConstants.js";
import { FLAT_PANEL_PUSH_BUTTON_OPTIONS, LIGHT_SURFACE_TEXT_FILL } from "../MotionSensorButtonOptions.js";
import { SIM_CHECKBOX_OPTIONS } from "../MotionSensorControlOptions.js";
import { MotionSensorPanel } from "../MotionSensorPanel.js";
import { RunState, type RunStateValue } from "../model/RunState.js";
import type { SensorPositionSource } from "../model/SensorPositionSource.js";
import { SensorRange, type SensorRangeValue } from "../model/SensorRange.js";

const TITLE_FONT = new PhetFont({ size: 13, weight: "bold" });
const LABEL_FONT = new PhetFont(12);
const BUTTON_FONT = new PhetFont(12);
const READOUT_FONT = new PhetFont(11);

/** Decimals on the zero-offset readout; a millimetre is finer than the sensor resolves. */
const OFFSET_DECIMALS = 3;

export type SensorOptionsPanelOptions = {
  readonly source: SensorPositionSource;
  /** The recording's lifecycle; adjustments that would step the trace are locked while it records. */
  readonly runStateProperty: TReadOnlyProperty<RunStateValue>;
  /** Where the range combo box's popup goes, above everything else. */
  readonly listParent: Node;
};

export class SensorOptionsPanel extends MotionSensorPanel {
  /** Exposed so the ScreenView can order them in the PDOM. */
  public readonly changeSignCheckbox: Checkbox;
  public readonly zeroAtStartCheckbox: Checkbox;
  public readonly zeroNowButton: RectangularPushButton;
  public readonly removeZeroButton: RectangularPushButton;
  public readonly rangeComboBox: ComboBox<SensorRangeValue>;

  private readonly disposeSensorOptionsPanel: () => void;

  public constructor(providedOptions: SensorOptionsPanelOptions) {
    const source = providedOptions.source;
    const strings = StringManager.getInstance().getSensorOptionsStrings();

    const isIdleProperty = new DerivedProperty(
      [providedOptions.runStateProperty],
      (state) => state !== RunState.RECORDING,
    );

    const createCheckbox = (
      property: BooleanProperty,
      label: Text,
      enabledProperty?: TReadOnlyProperty<boolean>,
    ): Checkbox =>
      new Checkbox(property, label, {
        ...SIM_CHECKBOX_OPTIONS,
        accessibleName: label.stringProperty,
        ...(enabledProperty ? { enabledProperty: enabledProperty } : {}),
      });

    const changeSignCheckbox = createCheckbox(
      source.changeSignProperty,
      new Text(strings.changeSignStringProperty, {
        font: LABEL_FONT,
        fill: MotionSensorColors.textColorProperty,
        maxWidth: CONTROL_PANEL_WIDTH - 60,
      }),
      isIdleProperty,
    );
    const zeroAtStartCheckbox = createCheckbox(
      source.zeroAtStartProperty,
      new Text(strings.zeroAtStartStringProperty, {
        font: LABEL_FONT,
        fill: MotionSensorColors.textColorProperty,
        maxWidth: CONTROL_PANEL_WIDTH - 60,
      }),
    );

    // Zeroing needs a reading to zero *to*, so it waits for a connection. The
    // source takes a one-shot reading of its own when nothing is being recorded.
    const canZeroNowProperty = new DerivedProperty(
      [source.isAvailableProperty, isIdleProperty],
      (available, idle) => available && idle,
    );
    const zeroNowButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(strings.zeroNowStringProperty, { font: BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
      listener: () => {
        // Fire and forget: every outcome the student can act on already lands on
        // the offset readout or the connection panel. zeroNow() never rejects;
        // the catch is belt and braces, matching the source's own poll loop.
        source.zeroNow().catch(() => undefined);
      },
      accessibleName: strings.zeroNowStringProperty,
      enabledProperty: canZeroNowProperty,
    });

    const hasOffsetProperty = new DerivedProperty([source.zeroOffsetProperty], (offset) => offset !== 0);
    const canRemoveZeroProperty = new DerivedProperty(
      [hasOffsetProperty, isIdleProperty],
      (hasOffset, idle) => hasOffset && idle,
    );
    const removeZeroButton = new RectangularPushButton({
      ...FLAT_PANEL_PUSH_BUTTON_OPTIONS,
      content: new Text(strings.removeZeroStringProperty, { font: BUTTON_FONT, fill: LIGHT_SURFACE_TEXT_FILL }),
      listener: () => source.removeZeroOffset(),
      accessibleName: strings.removeZeroStringProperty,
      enabledProperty: canRemoveZeroProperty,
    });

    // The offset is invisible in the reading itself — the same 0.4 m can mean
    // two different places — so it is stated whenever there is one.
    const offsetValueProperty = new DerivedProperty([source.zeroOffsetProperty], (offset) =>
      toFixed(offset, OFFSET_DECIMALS),
    );
    const offsetProperty = new PatternStringProperty(strings.offsetPatternStringProperty, {
      offset: offsetValueProperty,
    });
    const offsetText = new Text(offsetProperty, {
      font: READOUT_FONT,
      fill: MotionSensorColors.textColorProperty,
      visibleProperty: hasOffsetProperty,
      maxWidth: CONTROL_PANEL_WIDTH - 40,
    });

    const rangeComboBox = new ComboBox(
      source.rangeProperty,
      [
        { value: SensorRange.LONG, createNode: () => new Text(strings.rangeLongStringProperty, comboItemOptions()) },
        { value: SensorRange.SHORT, createNode: () => new Text(strings.rangeShortStringProperty, comboItemOptions()) },
      ],
      providedOptions.listParent,
      {
        cornerRadius: 4,
        xMargin: 6,
        yMargin: 3,
        buttonFill: MotionSensorColors.panelBackgroundColorProperty,
        buttonStroke: MotionSensorColors.panelBorderColorProperty,
        listFill: MotionSensorColors.panelBackgroundColorProperty,
        listStroke: MotionSensorColors.panelBorderColorProperty,
        highlightFill: MotionSensorColors.panelBorderColorProperty,
        accessibleName: strings.rangeStringProperty,
      },
    );

    super(
      new VBox({
        align: "left",
        spacing: 8,
        preferredWidth: CONTROL_PANEL_WIDTH - 24,
        stretch: false,
        children: [
          new Text(strings.titleStringProperty, {
            font: TITLE_FONT,
            fill: MotionSensorColors.textColorProperty,
            maxWidth: CONTROL_PANEL_WIDTH - 40,
          }),
          changeSignCheckbox,
          zeroAtStartCheckbox,
          // One per row: side by side the two labels are wider than the control
          // column, and a panel that sticks out past its neighbours reads as a
          // mistake.
          new VBox({ align: "left", spacing: 6, children: [zeroNowButton, removeZeroButton] }),
          offsetText,
          new HBox({
            spacing: 8,
            children: [
              new Text(strings.rangeStringProperty, {
                font: LABEL_FONT,
                fill: MotionSensorColors.textColorProperty,
                maxWidth: CONTROL_PANEL_WIDTH - 140,
              }),
              rangeComboBox,
            ],
          }),
        ],
      }),
      { minWidth: CONTROL_PANEL_WIDTH },
    );

    this.changeSignCheckbox = changeSignCheckbox;
    this.zeroAtStartCheckbox = zeroAtStartCheckbox;
    this.zeroNowButton = zeroNowButton;
    this.removeZeroButton = removeZeroButton;
    this.rangeComboBox = rangeComboBox;

    this.disposeSensorOptionsPanel = () => {
      // The controls first: they hold listeners on the Properties below.
      for (const disposable of [
        changeSignCheckbox,
        zeroNowButton,
        removeZeroButton,
        rangeComboBox,
        offsetProperty,
        offsetValueProperty,
        canRemoveZeroProperty,
        hasOffsetProperty,
        canZeroNowProperty,
        isIdleProperty,
      ]) {
        disposable.dispose();
      }
    };
  }

  public override dispose(): void {
    this.disposeSensorOptionsPanel();
    super.dispose();
  }
}

/** Item labels sit on the panel fill, so they take the panel's text colour. */
function comboItemOptions() {
  return { font: LABEL_FONT, fill: MotionSensorColors.textColorProperty };
}
