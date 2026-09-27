/**
 * ConfigurableGraph.ts
 *
 * A chart whose two axes are chosen at run time from combo boxes, over a list of
 * {@link PlottableProperty}s the screen supplies. Position against time, velocity
 * against time, or velocity against position — the sim does not decide which
 * relationship is the interesting one; the student does.
 *
 * The graph is a floating overlay: drag it by its header bar, resize it from a
 * corner, zoom and pan with the button row or the wheel. Its visibility is owned
 * here and exposed through {@link getGraphVisibleProperty} for a checkbox to bind.
 *
 * Data is *pulled*, not pushed: {@link addDataPoint} samples the current value of
 * whichever two Properties are selected. Call it on the model's fixed sampling
 * clock rather than per animation frame, so points are evenly spaced in time.
 * Changing either axis clears the data — the points on screen were sampled from
 * different quantities and mixing them would be a lie.
 *
 * Ported from ACPhasor, which took it from Resonance, which took it from
 * OscillationsAndChaos. The sub-step (RK4 high-resolution) path is absent: this
 * sim's data comes from a real-world sampled source, not an integrator.
 */

import { BooleanProperty, Property, type TReadOnlyProperty } from "scenerystack/axon";
import { ChartRectangle, ChartTransform, GridLineSet, LinePlot, TickLabelSet, TickMarkSet } from "scenerystack/bamboo";
import { Range, toFixed } from "scenerystack/dot";
import { Shape } from "scenerystack/kite";
import { Orientation } from "scenerystack/phet-core";
import { FireListener, HBox, Node, Rectangle, Text } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import { StringManager } from "../../../i18n/StringManager.js";
import MotionSensorColors from "../../../MotionSensorColors.js";
import MotionSensorNamespace from "../../../MotionSensorNamespace.js";
import { announceGraphChange } from "../../util/GraphAnnouncer.js";
import { GraphControlsPanel } from "./GraphControlsPanel.js";
import { GraphDataManager } from "./GraphDataManager.js";
import { GraphInteractionHandler } from "./GraphInteractionHandler.js";
import type { PlottableProperty } from "./PlottableProperty.js";

// Grid line styling
const GRID_LINE_WIDTH = 0.5;
const PLOT_LINE_WIDTH = 2;
const TICK_EXTENT = 8;
const TICK_LABEL_FONT = new PhetFont({ size: 10 });
const TICK_LABEL_DECIMALS = 2;

// Axis labels
const AXIS_LABEL_FONT = new PhetFont({ size: 12 });
const AXIS_LABEL_OFFSET = 35;

// Axis interaction regions
const Y_AXIS_INTERACTION_WIDTH = 60;
const X_AXIS_INTERACTION_HEIGHT = 30;

// Control button styling
const BUTTON_SIZE = 24;
const BUTTON_PADDING = 4;
const BUTTON_SPACING = 2;
const BUTTON_CORNER_RADIUS = 3;
const BUTTON_FONT = new PhetFont({ size: 14, weight: "bold" });
const BUTTON_HOVER_OPACITY = 0.8;
const TITLE_BOTTOM_OFFSET = -5;

export class ConfigurableGraph extends Node {
  private readonly availableProperties: PlottableProperty[];
  private readonly xPropertyProperty: Property<PlottableProperty>;
  private readonly yPropertyProperty: Property<PlottableProperty>;
  private readonly chartTransform: ChartTransform;
  private readonly linePlot: LinePlot;
  private readonly chartRectangle: ChartRectangle;
  private graphWidth: number;
  private graphHeight: number;
  private readonly initialWidth: number;
  private readonly initialHeight: number;

  // Drag and resize UI components
  private readonly headerBar;
  private readonly isDraggingProperty: BooleanProperty;
  private readonly isResizingProperty: BooleanProperty;

  // Trail points
  private readonly trailNode: Node;

  // Clipped data container for line plot and trail
  private readonly clippedDataContainer: Node;

  // Visibility control
  private readonly graphVisibleProperty: BooleanProperty;
  private readonly graphContentNode: Node;

  // Axis labels
  private readonly xAxisLabelNode: Text;
  private readonly yAxisLabelNode: Text;

  // Grid and tick components
  private readonly verticalGridLineSet: GridLineSet;
  private readonly horizontalGridLineSet: GridLineSet;
  private readonly xTickMarkSet: TickMarkSet;
  private readonly yTickMarkSet: TickMarkSet;
  private readonly xTickLabelSet: TickLabelSet;
  private readonly yTickLabelSet: TickLabelSet;

  // Invisible interaction regions for axis controls
  private readonly xAxisInteractionRegion: Rectangle;
  private readonly yAxisInteractionRegion: Rectangle;

  // Module instances
  private readonly dataManager: GraphDataManager;
  private readonly interactionHandler: GraphInteractionHandler;
  private readonly controlsPanel: GraphControlsPanel;

  // Control buttons
  private readonly rescaleButton: Node;
  private readonly controlButtonsPanel: Node;

  /**
   * @param availableProperties - List of properties that can be plotted
   * @param initialXProperty - Initial property for x-axis
   * @param initialYProperty - Initial property for y-axis
   * @param width - Graph width in pixels
   * @param height - Graph height in pixels
   * @param listParent - Parent node for combo box lists
   * @param maxDataPoints - Maximum number of points to store
   */
  public constructor(
    availableProperties: PlottableProperty[],
    initialXProperty: PlottableProperty,
    initialYProperty: PlottableProperty,
    width: number,
    height: number,
    listParent: Node,
    maxDataPoints: number = 2000,
  ) {
    super();

    this.availableProperties = availableProperties;
    this.graphWidth = width;
    this.graphHeight = height;
    this.initialWidth = width;
    this.initialHeight = height;

    // Properties to track current axis selections
    this.xPropertyProperty = new Property(initialXProperty);
    this.yPropertyProperty = new Property(initialYProperty);

    // Property to control graph visibility
    // Visible by default: the graph is this sim's primary display, not an
    // accessory tool, so hiding it is the choice a student makes rather than the
    // state they start in. Reset All returns here.
    this.graphVisibleProperty = new BooleanProperty(true);

    // Properties for drag and resize states
    this.isDraggingProperty = new BooleanProperty(false);
    this.isResizingProperty = new BooleanProperty(false);

    // Create a container for all graph content
    this.graphContentNode = new Node();

    // Create chart transform with initial ranges
    const initialRange = new Range(-10, 10);
    this.chartTransform = new ChartTransform({
      viewWidth: width,
      viewHeight: height,
      modelXRange: initialRange,
      modelYRange: initialRange,
    });

    // Create chart background
    this.chartRectangle = new ChartRectangle(this.chartTransform, {
      fill: MotionSensorColors.chartBackgroundColorProperty,
      stroke: MotionSensorColors.panelBorderColorProperty,
    });
    this.graphContentNode.addChild(this.chartRectangle);

    // Create grid lines, tick marks, and tick labels
    const initialSpacing = GraphDataManager.calculateTickSpacing(initialRange.getLength());

    this.verticalGridLineSet = new GridLineSet(this.chartTransform, Orientation.VERTICAL, initialSpacing, {
      stroke: MotionSensorColors.chartGridColorProperty,
      lineWidth: GRID_LINE_WIDTH,
    });
    this.graphContentNode.addChild(this.verticalGridLineSet);

    this.horizontalGridLineSet = new GridLineSet(this.chartTransform, Orientation.HORIZONTAL, initialSpacing, {
      stroke: MotionSensorColors.chartGridColorProperty,
      lineWidth: GRID_LINE_WIDTH,
    });
    this.graphContentNode.addChild(this.horizontalGridLineSet);

    this.xTickMarkSet = new TickMarkSet(this.chartTransform, Orientation.HORIZONTAL, initialSpacing, {
      edge: "min",
      extent: TICK_EXTENT,
      stroke: MotionSensorColors.panelBorderColorProperty,
    });
    this.graphContentNode.addChild(this.xTickMarkSet);

    this.yTickMarkSet = new TickMarkSet(this.chartTransform, Orientation.VERTICAL, initialSpacing, {
      edge: "min",
      extent: TICK_EXTENT,
      stroke: MotionSensorColors.panelBorderColorProperty,
    });
    this.graphContentNode.addChild(this.yTickMarkSet);

    this.xTickLabelSet = new TickLabelSet(this.chartTransform, Orientation.HORIZONTAL, initialSpacing, {
      edge: "min",
      createLabel: (value: number) =>
        new Text(toFixed(value, TICK_LABEL_DECIMALS), {
          font: TICK_LABEL_FONT,
          fill: MotionSensorColors.textColorProperty,
        }),
    });
    this.graphContentNode.addChild(this.xTickLabelSet);

    this.yTickLabelSet = new TickLabelSet(this.chartTransform, Orientation.VERTICAL, initialSpacing, {
      edge: "min",
      createLabel: (value: number) =>
        new Text(toFixed(value, TICK_LABEL_DECIMALS), {
          font: TICK_LABEL_FONT,
          fill: MotionSensorColors.textColorProperty,
        }),
    });
    this.graphContentNode.addChild(this.yTickLabelSet);

    // Create invisible interaction regions for axis controls
    // These regions capture mouse/touch events across the entire tick label area,
    // not just on the text labels themselves
    const axisInteractionWidth = Y_AXIS_INTERACTION_WIDTH;
    const axisInteractionHeight = X_AXIS_INTERACTION_HEIGHT;

    // Y-axis interaction region (left side of graph, covering full height)
    this.yAxisInteractionRegion = new Rectangle(-axisInteractionWidth, 0, axisInteractionWidth, height, {
      fill: "transparent",
      pickable: true,
    });
    this.graphContentNode.addChild(this.yAxisInteractionRegion);

    // X-axis interaction region (bottom of graph, covering full width)
    this.xAxisInteractionRegion = new Rectangle(0, height, width, axisInteractionHeight, {
      fill: "transparent",
      pickable: true,
    });
    this.graphContentNode.addChild(this.xAxisInteractionRegion);

    // Create line plot
    this.linePlot = new LinePlot(this.chartTransform, [], {
      stroke: MotionSensorColors.traceColorProperty,
      lineWidth: PLOT_LINE_WIDTH,
    });

    // Create trail node for showing recent points
    this.trailNode = new Node();

    // Wrap line plot and trail in a clipped container to prevent overflow beyond the grid
    this.clippedDataContainer = new Node({
      children: [this.linePlot, this.trailNode],
      clipArea: Shape.rect(0, 0, width, height),
    });
    this.graphContentNode.addChild(this.clippedDataContainer);

    // Create axis labels
    this.xAxisLabelNode = new Text(this.formatAxisLabel(initialXProperty), {
      font: AXIS_LABEL_FONT,
      fill: MotionSensorColors.textColorProperty,
      centerX: this.graphWidth / 2,
      top: this.graphHeight + AXIS_LABEL_OFFSET,
    });
    this.graphContentNode.addChild(this.xAxisLabelNode);

    this.yAxisLabelNode = new Text(this.formatAxisLabel(initialYProperty), {
      font: AXIS_LABEL_FONT,
      fill: MotionSensorColors.textColorProperty,
      rotation: -Math.PI / 2,
      centerY: this.graphHeight / 2,
      right: -AXIS_LABEL_OFFSET,
    });
    this.graphContentNode.addChild(this.yAxisLabelNode);

    // Initialize data manager
    this.dataManager = new GraphDataManager(this.chartTransform, this.linePlot, this.trailNode, maxDataPoints, {
      verticalGridLineSet: this.verticalGridLineSet,
      horizontalGridLineSet: this.horizontalGridLineSet,
      xTickMarkSet: this.xTickMarkSet,
      yTickMarkSet: this.yTickMarkSet,
      xTickLabelSet: this.xTickLabelSet,
      yTickLabelSet: this.yTickLabelSet,
    });

    // Create controls panel helper
    const controlsPanel = new GraphControlsPanel(
      this.availableProperties,
      this.xPropertyProperty,
      this.yPropertyProperty,
      this.graphWidth,
    );
    this.controlsPanel = controlsPanel;

    // Create title panel with combo boxes for axis selection
    const titlePanel = controlsPanel.createTitlePanel(listParent);
    titlePanel.centerX = this.graphWidth / 2;
    titlePanel.bottom = TITLE_BOTTOM_OFFSET;
    this.graphContentNode.addChild(titlePanel);

    // Create control buttons panel with rescale, zoom, and pan buttons
    const buttonSize = BUTTON_SIZE;
    const buttonPadding = BUTTON_PADDING;
    const buttonSpacing = BUTTON_SPACING;

    // Helper function to create a button. The glyph is decorative — a screen
    // reader gets the accessible name, not "↻".
    const graphStrings = StringManager.getInstance().getGraphA11yStrings();
    const createButton = (label: string, onClick: () => void, accessibleName: TReadOnlyProperty<string>): Node => {
      const buttonText = new Text(label, {
        font: BUTTON_FONT,
        fill: MotionSensorColors.panelBorderColorProperty,
      });

      const buttonBackground = new Rectangle(0, 0, buttonSize, buttonSize, BUTTON_CORNER_RADIUS, BUTTON_CORNER_RADIUS, {
        fill: MotionSensorColors.panelBackgroundColorProperty,
        stroke: MotionSensorColors.panelBorderColorProperty,
        cursor: "pointer",
      });

      const button = new Node({
        children: [buttonBackground, buttonText],
        tagName: "button",
        accessibleName: accessibleName,
      });

      // Center the text in the button
      buttonText.center = buttonBackground.center;

      // Add hover effect
      button.addInputListener({
        enter: () => {
          buttonBackground.opacity = BUTTON_HOVER_OPACITY;
        },
        exit: () => {
          buttonBackground.opacity = 1.0;
        },
      });

      // Add click handler
      button.addInputListener(
        new FireListener({
          fire: onClick,
        }),
      );

      return button;
    };

    // Create rescale button
    this.rescaleButton = createButton(
      "↻",
      () => {
        // Reset manual zoom flag and rescale to fit data
        this.dataManager.setManuallyZoomed(false);
        this.dataManager.updateAxisRanges();
      },
      graphStrings.rescaleStringProperty,
    );

    // Create zoom buttons (will be wired up after interactionHandler is created)
    const zoomInButton = createButton(
      "+",
      () => {
        this.interactionHandler.zoomIn();
      },
      graphStrings.zoomInStringProperty,
    );

    const zoomOutButton = createButton(
      "−",
      () => {
        this.interactionHandler.zoomOut();
      },
      graphStrings.zoomOutStringProperty,
    );

    // Create pan buttons (will be wired up after interactionHandler is created)
    const panLeftButton = createButton(
      "←",
      () => {
        this.interactionHandler.pan("left");
      },
      graphStrings.panLeftStringProperty,
    );

    const panRightButton = createButton(
      "→",
      () => {
        this.interactionHandler.pan("right");
      },
      graphStrings.panRightStringProperty,
    );

    const panUpButton = createButton(
      "↑",
      () => {
        this.interactionHandler.pan("up");
      },
      graphStrings.panUpStringProperty,
    );

    const panDownButton = createButton(
      "↓",
      () => {
        this.interactionHandler.pan("down");
      },
      graphStrings.panDownStringProperty,
    );

    // Create HBox to hold all buttons
    this.controlButtonsPanel = new HBox({
      children: [
        this.rescaleButton,
        zoomInButton,
        zoomOutButton,
        panLeftButton,
        panRightButton,
        panUpButton,
        panDownButton,
      ],
      spacing: buttonSpacing,
      left: buttonPadding,
      top: buttonPadding,
    });

    this.graphContentNode.addChild(this.controlButtonsPanel);

    // Update labels when axes change
    this.xPropertyProperty.link((property) => {
      this.xAxisLabelNode.string = this.formatAxisLabel(property);
      this.xAxisLabelNode.centerX = this.graphWidth / 2;
      this.replot();
      announceGraphChange(
        graphStrings.xAxisChangedStringProperty.value.replace("{{property}}", this.getNameValue(property.name)),
      );
    });

    this.yPropertyProperty.link((property) => {
      this.yAxisLabelNode.string = this.formatAxisLabel(property);
      this.yAxisLabelNode.centerY = this.graphHeight / 2;
      this.replot();
      announceGraphChange(
        graphStrings.yAxisChangedStringProperty.value.replace("{{property}}", this.getNameValue(property.name)),
      );
    });

    // Create header bar (checkbox is now in ToolsControlPanel)
    this.headerBar = controlsPanel.createHeaderBar();

    // Add header bar first (so it's behind the combo boxes in z-order)
    this.addChild(this.headerBar);

    // Add the graph content container (so combo boxes appear in front of header bar)
    this.addChild(this.graphContentNode);

    // Initialize interaction handler
    this.interactionHandler = new GraphInteractionHandler(
      {
        chartTransform: this.chartTransform,
        chartRectangle: this.chartRectangle,
        dataManager: this.dataManager,
      },
      {
        isDraggingProperty: this.isDraggingProperty,
        isResizingProperty: this.isResizingProperty,
      },
      {
        headerBar: this.headerBar,
        graphNode: this,
        xTickLabelSet: this.xTickLabelSet,
        yTickLabelSet: this.yTickLabelSet,
        xAxisInteractionRegion: this.xAxisInteractionRegion,
        yAxisInteractionRegion: this.yAxisInteractionRegion,
      },
      {
        width: this.graphWidth,
        height: this.graphHeight,
      },
      this.resizeGraph.bind(this),
    );

    // Setup all interactions
    this.interactionHandler.initialize();

    // Create and add resize handles
    const resizeHandles = this.interactionHandler.createResizeHandles();
    for (const handle of resizeHandles) {
      this.addChild(handle);
    }

    // Link visibility property to the content node, header bar, and resize handles
    this.graphVisibleProperty.link((visible) => {
      this.graphContentNode.visible = visible;
      this.headerBar.visible = visible;
      for (const handle of resizeHandles) {
        handle.visible = visible;
      }
    });

    // Add visual feedback for drag and resize operations
    this.isDraggingProperty.link((isDragging) => {
      this.opacity = isDragging ? 0.8 : 1.0;
      this.headerBar.cursor = isDragging ? "grabbing" : "grab";
    });

    this.isResizingProperty.link((isResizing) => {
      this.opacity = isResizing ? 0.8 : 1.0;
    });
  }

  /**
   * Helper to get the string value from either a string or TReadOnlyProperty<string>
   */
  private getNameValue(name: string | TReadOnlyProperty<string>): string {
    return typeof name === "string" ? name : name.value;
  }

  /**
   * Format an axis label with the property name and unit
   */
  private formatAxisLabel(property: PlottableProperty): string {
    const nameValue = this.getNameValue(property.name);
    if (property.unit) {
      return `${nameValue} (${property.unit})`;
    }
    return nameValue;
  }

  /**
   * Resize the graph to new dimensions
   */
  private resizeGraph(newWidth: number, newHeight: number): void {
    this.graphWidth = newWidth;
    this.graphHeight = newHeight;

    // Update header bar
    GraphControlsPanel.updateHeaderBarWidth(this.headerBar, newWidth);

    // Update clipping area BEFORE updating chart transform to prevent temporary clipping during resize
    this.clippedDataContainer.clipArea = Shape.rect(0, 0, newWidth, newHeight);

    // Update chart transform
    this.chartTransform.setViewWidth(newWidth);
    this.chartTransform.setViewHeight(newHeight);

    // Update invisible interaction regions
    const axisInteractionWidth = 60;
    const axisInteractionHeight = 30;
    this.yAxisInteractionRegion.setRect(-axisInteractionWidth, 0, axisInteractionWidth, newHeight);
    this.xAxisInteractionRegion.setRect(0, newHeight, newWidth, axisInteractionHeight);

    // Update axis labels positions
    this.xAxisLabelNode.centerX = newWidth / 2;
    this.xAxisLabelNode.top = newHeight + 35;
    this.yAxisLabelNode.centerY = newHeight / 2;

    // Update title panel position
    const titlePanel = this.graphContentNode.children.find((child) => child instanceof HBox);
    if (titlePanel) {
      titlePanel.centerX = newWidth / 2;
    }

    // Update interaction handler dimensions
    this.interactionHandler.updateDimensions(newWidth, newHeight);
    this.interactionHandler.updateResizeHandlePositions();

    // Update trail with new transform
    this.dataManager.updateTrail();
  }

  /**
   * Add a new data point sampled from the current x and y axis property values.
   * Call this once per frame (e.g. from the screen view's step) while the graph is visible.
   */
  public addDataPoint(): void {
    const xValue = this.xPropertyProperty.value.property.value;
    const yValue = this.yPropertyProperty.value.property.value;

    this.dataManager.addDataPoint(xValue, yValue);
  }

  /**
   * Clear all data points
   */
  /**
   * Redraw the plot for the current pair of axes.
   *
   * The points already on screen were sampled from whichever quantities were
   * selected a moment ago, so they cannot simply be kept. When both plottables
   * can hand back their recorded series the plot is rebuilt from those, which is
   * what lets one recording be looked at on several pairs of axes; when either
   * cannot, the only honest thing left is to start empty.
   */
  public replot(): void {
    this.dataManager.clearData();

    const xSamples = this.xPropertyProperty.value.samples?.();
    const ySamples = this.yPropertyProperty.value.samples?.();
    if (xSamples === undefined || ySamples === undefined) {
      return;
    }

    const count = Math.min(xSamples.length, ySamples.length);
    for (let index = 0; index < count; index++) {
      const x = xSamples[index];
      const y = ySamples[index];
      if (x !== undefined && y !== undefined) {
        this.dataManager.addDataPoint(x, y);
      }
    }
  }

  public clearData(): void {
    this.dataManager.clearData();
  }

  /**
   * Get the current x-axis property
   * @unused Not called from outside this class.
   */
  public getXProperty(): PlottableProperty {
    return this.xPropertyProperty.value;
  }

  /**
   * Get the current y-axis property
   * @unused Not called from outside this class.
   */
  public getYProperty(): PlottableProperty {
    return this.yPropertyProperty.value;
  }

  /**
   * Get the graph visibility property
   */
  public getGraphVisibleProperty(): BooleanProperty {
    return this.graphVisibleProperty;
  }

  /**
   * Reset the graph to its initial state
   */
  public reset(): void {
    this.graphVisibleProperty.reset();

    // The axes go back to the pair the graph was built with. Reset All that left
    // a student's last axis choice in place would not be a reset.
    this.xPropertyProperty.reset();
    this.yPropertyProperty.reset();

    // Reset graph size to initial dimensions if it has been resized
    if (this.graphWidth !== this.initialWidth || this.graphHeight !== this.initialHeight) {
      this.resizeGraph(this.initialWidth, this.initialHeight);
    }

    // Clear all data
    this.clearData();
  }

  /**
   * Release everything this graph holds: the pointer listeners, the combo boxes
   * and their derived Properties, and its own axis-selection state. The
   * {@link PlottableProperty} list it was given is only ever sampled, never
   * linked, so those model Properties are left alone.
   */
  public override dispose(): void {
    this.interactionHandler.dispose();
    this.controlsPanel.dispose();
    this.headerBar.dispose();
    this.graphVisibleProperty.dispose();
    this.isDraggingProperty.dispose();
    this.isResizingProperty.dispose();
    // Last: the combo boxes above were listening to these.
    this.xPropertyProperty.dispose();
    this.yPropertyProperty.dispose();
    super.dispose();
  }
}

// Register with namespace for debugging accessibility
MotionSensorNamespace.register("ConfigurableGraph", ConfigurableGraph);
