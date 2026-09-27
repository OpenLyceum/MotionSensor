/**
 * GraphControlsPanel.ts
 *
 * The chrome around {@link ConfigurableGraph}: the "(Y vs X)" title made of two
 * combo boxes, and the header bar you drag the graph by. The combo boxes and the
 * derived Properties behind them listen to things that outlive the graph, so they
 * are collected in `disposables` and released together.
 *
 * Ported alongside ConfigurableGraph; colors and namespace remapped, and the i18n
 * source swapped to this sim's StringManager.
 */

import { DerivedProperty, type Property, type TReadOnlyProperty } from "scenerystack/axon";
import { HBox, type Node, Rectangle, Text } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { ComboBox } from "scenerystack/sun";
import { StringManager } from "../../../i18n/StringManager.js";
import MotionSensorColors from "../../../MotionSensorColors.js";
import MotionSensorNamespace from "../../../MotionSensorNamespace.js";
import type { PlottableProperty } from "./PlottableProperty.js";

// Font sizes
const COMBO_BOX_FONT = new PhetFont({ size: 12 });
const TITLE_FONT = new PhetFont({ size: 14 });

// Layout constants
const COMBO_BOX_CORNER_RADIUS = 5;
const COMBO_BOX_X_MARGIN = 6;
const COMBO_BOX_Y_MARGIN = 3;
const TITLE_SPACING = 3;
const HEADER_HEIGHT = 30;
const HEADER_CORNER_RADIUS = 5;
const HEADER_LINE_WIDTH = 2;
const HEADER_DARKEN_FACTOR = 0.1;

export class GraphControlsPanel {
  private readonly availableProperties: PlottableProperty[];
  private readonly xPropertyProperty: Property<PlottableProperty>;
  private readonly yPropertyProperty: Property<PlottableProperty>;
  private readonly graphWidth: number;

  /**
   * The combo boxes and derived Properties this panel builds. Both derived
   * Properties listen to something that outlives the graph — a localized string
   * and a global color — so they are released in {@link dispose}.
   */
  private readonly disposables: { dispose(): void }[] = [];

  public constructor(
    availableProperties: PlottableProperty[],
    xPropertyProperty: Property<PlottableProperty>,
    yPropertyProperty: Property<PlottableProperty>,
    graphWidth: number,
  ) {
    this.availableProperties = availableProperties;
    this.xPropertyProperty = xPropertyProperty;
    this.yPropertyProperty = yPropertyProperty;
    this.graphWidth = graphWidth;
  }

  /**
   * Helper to get the string value from either a string or TReadOnlyProperty<string>
   */
  private getNameValue(name: string | TReadOnlyProperty<string>): string {
    return typeof name === "string" ? name : name.value;
  }

  /**
   * Sanitize a name for use as a tandem name (keep only alphanumeric characters)
   */
  private sanitizeTandemName(name: string | TReadOnlyProperty<string>): string {
    const nameValue = this.getNameValue(name);
    // Keep only alphanumeric characters (remove spaces, punctuation, etc.)
    return nameValue.replace(/[^a-zA-Z0-9]/g, "");
  }

  /**
   * Create title panel with "(Y vs X)" format where Y and X are combo boxes
   */
  public createTitlePanel(listParent: Node): Node {
    const xItems = this.availableProperties.map((prop) => ({
      value: prop,
      createNode: () =>
        new Text(prop.name, {
          font: COMBO_BOX_FONT,
          fill: MotionSensorColors.textColorProperty,
        }),
      tandemName: `${this.sanitizeTandemName(prop.name)}Item`,
    }));

    const graphStrings = StringManager.getInstance().getGraphA11yStrings();

    const xComboBox = new ComboBox(this.xPropertyProperty, xItems, listParent, {
      cornerRadius: COMBO_BOX_CORNER_RADIUS,
      xMargin: COMBO_BOX_X_MARGIN,
      yMargin: COMBO_BOX_Y_MARGIN,
      buttonFill: MotionSensorColors.panelBackgroundColorProperty,
      buttonStroke: MotionSensorColors.panelBorderColorProperty,
      listFill: MotionSensorColors.panelBackgroundColorProperty,
      listStroke: MotionSensorColors.panelBorderColorProperty,
      highlightFill: MotionSensorColors.panelBorderColorProperty,
      accessibleName: graphStrings.xAxisStringProperty,
    });

    const yItems = this.availableProperties.map((prop) => ({
      value: prop,
      createNode: () =>
        new Text(prop.name, {
          font: COMBO_BOX_FONT,
          fill: MotionSensorColors.textColorProperty,
        }),
      tandemName: `${this.sanitizeTandemName(prop.name)}Item`,
    }));

    const yComboBox = new ComboBox(this.yPropertyProperty, yItems, listParent, {
      cornerRadius: COMBO_BOX_CORNER_RADIUS,
      xMargin: COMBO_BOX_X_MARGIN,
      yMargin: COMBO_BOX_Y_MARGIN,
      buttonFill: MotionSensorColors.panelBackgroundColorProperty,
      buttonStroke: MotionSensorColors.panelBorderColorProperty,
      listFill: MotionSensorColors.panelBackgroundColorProperty,
      listStroke: MotionSensorColors.panelBorderColorProperty,
      highlightFill: MotionSensorColors.panelBorderColorProperty,
      accessibleName: graphStrings.yAxisStringProperty,
    });

    // Create title in format "(Y vs X)"
    const leftParen = new Text("(", {
      font: TITLE_FONT,
      fill: MotionSensorColors.textColorProperty,
    });

    const vsStringProperty = graphStrings.vsStringProperty;
    const paddedVsProperty = new DerivedProperty([vsStringProperty], (vs: string) => ` ${vs} `);
    const vsText = new Text(paddedVsProperty, {
      font: TITLE_FONT,
      fill: MotionSensorColors.textColorProperty,
    });
    this.disposables.push(xComboBox, yComboBox, vsText, paddedVsProperty);

    const rightParen = new Text(")", {
      font: TITLE_FONT,
      fill: MotionSensorColors.textColorProperty,
    });

    // Arrange in horizontal layout: (Y vs X)
    return new HBox({
      spacing: TITLE_SPACING,
      align: "center",
      children: [leftParen, yComboBox, vsText, xComboBox, rightParen],
    });
  }

  /**
   * Create the header bar (without checkbox - checkbox is now in ToolsControlPanel)
   */
  public createHeaderBar(): Rectangle {
    // Create header bar with dynamic fill that darkens the control panel background
    const headerFillProperty = new DerivedProperty(
      [MotionSensorColors.panelBackgroundColorProperty],
      (backgroundColor) => backgroundColor.colorUtilsDarker(HEADER_DARKEN_FACTOR),
    );
    const headerBar = new Rectangle(
      0,
      -HEADER_HEIGHT,
      this.graphWidth,
      HEADER_HEIGHT,
      HEADER_CORNER_RADIUS,
      HEADER_CORNER_RADIUS,
      {
        fill: headerFillProperty,
        stroke: MotionSensorColors.panelBorderColorProperty,
        lineWidth: HEADER_LINE_WIDTH,
        cursor: "grab",
      },
    );
    // The fill darkens a global color Property, so it has to be let go of
    // explicitly — otherwise every graph ever built stays on its listener list.
    this.disposables.push(headerFillProperty);

    return headerBar;
  }

  /** Release the combo boxes and the derived Properties built above. */
  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  /**
   * Update header bar width when graph is resized
   */
  public static updateHeaderBarWidth(headerBar: Rectangle, newWidth: number): void {
    headerBar.setRect(0, -HEADER_HEIGHT, newWidth, HEADER_HEIGHT);
  }
}

// Register with namespace for debugging accessibility
MotionSensorNamespace.register("GraphControlsPanel", GraphControlsPanel);
