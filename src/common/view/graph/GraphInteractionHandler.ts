/**
 * GraphInteractionHandler.ts
 *
 * Every pointer gesture {@link ConfigurableGraph} understands: wheel and pinch
 * zoom, drag-to-pan, dragging a single axis to rescale it, dragging the header
 * bar to move the whole graph, and the corner handles that resize it.
 *
 * Each listener is attached through `attach()` so that `dispose()` can take them
 * all back off again — a discarded graph that stays wired to the pointer is a
 * leak the memory-leak suite will catch.
 *
 * Ported alongside ConfigurableGraph; colors and namespace remapped.
 */

import type { BooleanProperty } from "scenerystack/axon";
import type { ChartRectangle, ChartTransform, TickLabelSet } from "scenerystack/bamboo";
import { Range, Vector2 } from "scenerystack/dot";
import {
  DragListener,
  type Node,
  type Pointer,
  Rectangle,
  RichDragListener,
  type TInputListener,
} from "scenerystack/scenery";
import MotionSensorColors from "../../../MotionSensorColors.js";
import MotionSensorNamespace from "../../../MotionSensorNamespace.js";
import type { GraphDataManager } from "./GraphDataManager.js";

/**
 * Configuration for the chart and its data management
 */
export interface ChartConfig {
  chartTransform: ChartTransform;
  chartRectangle: ChartRectangle;
  dataManager: GraphDataManager;
}

/**
 * UI state properties for graph interactions
 */
export interface GraphUIState {
  isDraggingProperty: BooleanProperty;
  isResizingProperty: BooleanProperty;
}

/**
 * UI elements that the interaction handler needs to reference
 */
export interface GraphUIElements {
  headerBar: Rectangle;
  graphNode: Node;
  xTickLabelSet: TickLabelSet;
  yTickLabelSet: TickLabelSet;
  xAxisInteractionRegion: Rectangle;
  yAxisInteractionRegion: Rectangle;
}

/**
 * Graph dimensions
 */
export interface GraphDimensions {
  width: number;
  height: number;
}

export class GraphInteractionHandler {
  private readonly chartTransform: ChartTransform;
  private readonly chartRectangle: ChartRectangle;
  private readonly dataManager: GraphDataManager;
  private readonly zoomFactor: number = 1.1; // 10% zoom per wheel tick

  // For header drag
  private readonly headerBar: Rectangle;
  private readonly graphNode: Node;
  private readonly isDraggingProperty: BooleanProperty;

  // For resize
  private readonly resizeHandles: Rectangle[] = [];
  private readonly isResizingProperty: BooleanProperty;
  private readonly onResize: (width: number, height: number) => void;

  // For axis controls
  private readonly xAxisInteractionRegion: Rectangle;
  private readonly yAxisInteractionRegion: Rectangle;
  private graphWidth: number;
  private graphHeight: number;

  /**
   * Every input listener this handler attached, with the node it went on. The
   * nodes belong to the graph, which a screen swap discards — see {@link dispose}.
   */
  private readonly attachedListeners: { node: Node; listener: TInputListener }[] = [];

  public constructor(
    chartConfig: ChartConfig,
    uiState: GraphUIState,
    uiElements: GraphUIElements,
    dimensions: GraphDimensions,
    onResize: (width: number, height: number) => void,
  ) {
    this.chartTransform = chartConfig.chartTransform;
    this.chartRectangle = chartConfig.chartRectangle;
    this.dataManager = chartConfig.dataManager;
    this.headerBar = uiElements.headerBar;
    this.graphNode = uiElements.graphNode;
    this.isDraggingProperty = uiState.isDraggingProperty;
    this.isResizingProperty = uiState.isResizingProperty;
    this.xAxisInteractionRegion = uiElements.xAxisInteractionRegion;
    this.yAxisInteractionRegion = uiElements.yAxisInteractionRegion;
    this.graphWidth = dimensions.width;
    this.graphHeight = dimensions.height;
    this.onResize = onResize;
  }

  /**
   * Initialize all interaction handlers
   */
  public initialize(): void {
    this.setupZoomControls();
    this.setupPanControls();
    this.setupTouchZoomControls();
    this.setupYAxisTouchControls();
    this.setupXAxisTouchControls();
    this.setupHeaderDrag();
  }

  /**
   * Attach an input listener and remember it, so {@link dispose} can take it
   * back off again. Everything this class adds goes through here.
   */
  private attach(node: Node, listener: TInputListener): void {
    node.addInputListener(listener);
    this.attachedListeners.push({ node: node, listener: listener });
  }

  /**
   * Detach every listener this handler added and dispose the ones that own
   * state of their own (the drag listeners). Without this a discarded graph
   * stays wired to the pointer.
   */
  public dispose(): void {
    for (const { node, listener } of this.attachedListeners) {
      node.removeInputListener(listener);
      (listener as { dispose?: () => void }).dispose?.();
    }
    this.attachedListeners.length = 0;

    for (const handle of this.resizeHandles) {
      handle.dispose();
    }
    this.resizeHandles.length = 0;
  }

  /**
   * Setup non-intrusive zoom controls using mouse wheel and keyboard
   */
  private setupZoomControls(): void {
    // Mouse wheel zoom on the chart area
    this.attach(this.chartRectangle, {
      wheel: (event) => {
        event.handle();
        const delta = event.domEvent?.deltaY;
        if (delta === undefined) {
          return;
        }

        // Get mouse position relative to chart
        const pointerPoint = this.chartRectangle.globalToLocalPoint(event.pointer.point);

        // Zoom in or out
        if (delta < 0) {
          this.zoom(this.zoomFactor, pointerPoint);
        } else {
          this.zoom(1 / this.zoomFactor, pointerPoint);
        }
      },
    });

    // Double-click to reset to auto-scale
    this.attach(this.chartRectangle, {
      down: (event) => {
        if (event.domEvent && event.domEvent.detail === 2) {
          // Double click detected
          event.handle();
          this.resetZoom();
        }
      },
    });

    // Make chart rectangle pickable so it can receive input
    this.chartRectangle.pickable = true;
  }

  /**
   * Setup pan controls using drag
   */
  private setupPanControls(): void {
    let dragStartModelPoint: Vector2 | null = null;
    let dragStartXRange: Range | null = null;
    let dragStartYRange: Range | null = null;

    const dragListener = new RichDragListener({
      dragListenerOptions: {
        start: (event) => {
          const viewPoint = this.chartRectangle.globalToLocalPoint(event.pointer.point);
          dragStartModelPoint = this.chartTransform.viewToModelPosition(viewPoint);
          dragStartXRange = this.chartTransform.modelXRange.copy();
          dragStartYRange = this.chartTransform.modelYRange.copy();
          this.dataManager.setManuallyZoomed(true);
        },
        drag: (event) => {
          if (dragStartModelPoint && dragStartXRange && dragStartYRange) {
            const viewPoint = this.chartRectangle.globalToLocalPoint(event.pointer.point);
            const currentModelPoint = this.chartTransform.viewToModelPosition(viewPoint);
            const deltaX = dragStartModelPoint.x - currentModelPoint.x;
            const deltaY = dragStartModelPoint.y - currentModelPoint.y;
            const newXRange = new Range(dragStartXRange.min + deltaX, dragStartXRange.max + deltaX);
            const newYRange = new Range(dragStartYRange.min + deltaY, dragStartYRange.max + deltaY);
            this.chartTransform.setModelXRange(newXRange);
            this.chartTransform.setModelYRange(newYRange);
            this.dataManager.updateTickSpacing(newXRange, newYRange);
            this.dataManager.updateTrail();
          }
        },
        end: () => {
          dragStartModelPoint = null;
          dragStartXRange = null;
          dragStartYRange = null;
        },
      },
      keyboardDragListenerOptions: {
        dragSpeed: 200,
        shiftDragSpeed: 60,
        start: () => {
          this.dataManager.setManuallyZoomed(true);
        },
        drag: (_event, listener) => {
          const xRange = this.chartTransform.modelXRange;
          const yRange = this.chartTransform.modelYRange;
          const viewW = Math.max(1, this.graphWidth);
          const viewH = Math.max(1, this.graphHeight);
          const deltaX = (-listener.modelDelta.x * xRange.getLength()) / viewW;
          const deltaY = (listener.modelDelta.y * yRange.getLength()) / viewH;
          const newXRange = new Range(xRange.min + deltaX, xRange.max + deltaX);
          const newYRange = new Range(yRange.min + deltaY, yRange.max + deltaY);
          this.chartTransform.setModelXRange(newXRange);
          this.chartTransform.setModelYRange(newYRange);
          this.dataManager.updateTickSpacing(newXRange, newYRange);
          this.dataManager.updateTrail();
        },
      },
    });

    this.attach(this.chartRectangle, dragListener);
    this.chartRectangle.cursor = "move";

    // Keyboard pan: arrow keys translate the chart model ranges.
    this.chartRectangle.focusable = true;
    this.chartRectangle.tagName = "div";
  }

  /**
   * Setup touch-based pinch-to-zoom on the chart area
   */
  private setupTouchZoomControls(): void {
    // Track active touch pointers
    const activePointers = new Map<Pointer, Vector2>();
    let initialDistance: number | null = null;
    let initialMidpoint: Vector2 | null = null;
    let initialXRange: Range | null = null;
    let initialYRange: Range | null = null;

    this.attach(this.chartRectangle, {
      down: (event) => {
        // Only track touch events (not mouse)
        if (event.pointer.type === "touch") {
          const localPoint = this.chartRectangle.globalToLocalPoint(event.pointer.point);
          activePointers.set(event.pointer, localPoint);

          // If we now have exactly 2 touches, start pinch gesture
          if (activePointers.size === 2) {
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (point0 && point1) {
              initialDistance = point0.distance(point1);
              initialMidpoint = point0.average(point1);
              initialXRange = this.chartTransform.modelXRange.copy();
              initialYRange = this.chartTransform.modelYRange.copy();
              this.dataManager.setManuallyZoomed(true);
            }
          }
        }
      },

      move: (event) => {
        // Only handle touch events
        if (event.pointer.type === "touch" && activePointers.has(event.pointer)) {
          const localPoint = this.chartRectangle.globalToLocalPoint(event.pointer.point);
          activePointers.set(event.pointer, localPoint);

          // If we have exactly 2 touches, perform pinch zoom
          if (activePointers.size === 2 && initialDistance && initialMidpoint && initialXRange && initialYRange) {
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (!(point0 && point1)) {
              return;
            }
            const currentDistance = point0.distance(point1);

            // Calculate zoom factor from distance ratio
            const zoomFactor = initialDistance / currentDistance;

            // Convert initial midpoint to model coordinates
            const initialModelCenter = this.chartTransform.viewToModelPosition(initialMidpoint);

            // Calculate new ranges centered on the initial midpoint
            const xMin = initialModelCenter.x - (initialModelCenter.x - initialXRange.min) * zoomFactor;
            const xMax = initialModelCenter.x + (initialXRange.max - initialModelCenter.x) * zoomFactor;
            const yMin = initialModelCenter.y - (initialModelCenter.y - initialYRange.min) * zoomFactor;
            const yMax = initialModelCenter.y + (initialYRange.max - initialModelCenter.y) * zoomFactor;

            // Apply the zoom
            this.chartTransform.setModelXRange(new Range(xMin, xMax));
            this.chartTransform.setModelYRange(new Range(yMin, yMax));

            // Update tick spacing
            this.dataManager.updateTickSpacing(this.chartTransform.modelXRange, this.chartTransform.modelYRange);

            // Update trail
            this.dataManager.updateTrail();
          }
        }
      },

      up: (event) => {
        // Remove this pointer from tracking
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);

          // Reset pinch state if we no longer have 2 touches
          if (activePointers.size < 2) {
            initialDistance = null;
            initialMidpoint = null;
            initialXRange = null;
            initialYRange = null;
          }
        }
      },

      cancel: (event) => {
        // Handle cancelled touches (e.g., when gesture is interrupted)
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);
          if (activePointers.size < 2) {
            initialDistance = null;
            initialMidpoint = null;
            initialXRange = null;
            initialYRange = null;
          }
        }
      },
    });
  }

  /**
   * Setup touch controls for the Y-axis (tick labels)
   * Allows pinch-to-zoom on Y-axis only and one-finger drag for vertical panning
   */
  private setupYAxisTouchControls(): void {
    // Track active touch pointers for Y-axis
    const activePointers = new Map<Pointer, Vector2>();
    let initialYDistance: number | null = null;
    let initialYMidpoint: number | null = null;
    let initialYRange: Range | null = null;
    let singleTouchStartY: number | null = null;

    this.attach(this.yAxisInteractionRegion, {
      down: (event) => {
        if (event.pointer.type === "touch") {
          const globalPoint = event.pointer.point;
          activePointers.set(event.pointer, globalPoint);

          if (activePointers.size === 1) {
            // Single touch - prepare for vertical pan
            singleTouchStartY = globalPoint.y;
            initialYRange = this.chartTransform.modelYRange.copy();
            this.dataManager.setManuallyZoomed(true);
          } else if (activePointers.size === 2) {
            // Two touches - prepare for pinch zoom on Y-axis
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (point0 && point1) {
              initialYDistance = Math.abs(point0.y - point1.y);
              initialYMidpoint = (point0.y + point1.y) / 2;
              initialYRange = this.chartTransform.modelYRange.copy();
              singleTouchStartY = null; // Cancel single touch
              this.dataManager.setManuallyZoomed(true);
            }
          }
        }
      },

      move: (event) => {
        if (event.pointer.type === "touch" && activePointers.has(event.pointer)) {
          const globalPoint = event.pointer.point;
          activePointers.set(event.pointer, globalPoint);

          if (activePointers.size === 1 && singleTouchStartY !== null && initialYRange) {
            // Single touch - vertical pan
            const deltaY = globalPoint.y - singleTouchStartY;

            // Convert delta to model coordinates
            const modelDeltaY = deltaY * (initialYRange.getLength() / this.graphHeight);

            const newYRange = new Range(initialYRange.min + modelDeltaY, initialYRange.max + modelDeltaY);

            this.chartTransform.setModelYRange(newYRange);
            this.dataManager.updateTickSpacing(this.chartTransform.modelXRange, newYRange);
            this.dataManager.updateTrail();
          } else if (activePointers.size === 2 && initialYDistance && initialYMidpoint !== null && initialYRange) {
            // Two touches - pinch zoom on Y-axis only
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (!(point0 && point1)) {
              return;
            }
            const currentYDistance = Math.abs(point0.y - point1.y);

            // Calculate zoom factor from Y-distance ratio
            const zoomFactor = initialYDistance / currentYDistance;

            // Convert initial midpoint Y to model coordinates
            const viewMidpoint = new Vector2(this.graphWidth / 2, initialYMidpoint);
            const localMidpoint = this.chartRectangle.globalToLocalPoint(viewMidpoint);
            const modelMidpointY = this.chartTransform.viewToModelPosition(localMidpoint).y;

            // Calculate new Y range centered on the midpoint
            const yMin = modelMidpointY - (modelMidpointY - initialYRange.min) * zoomFactor;
            const yMax = modelMidpointY + (initialYRange.max - modelMidpointY) * zoomFactor;

            this.chartTransform.setModelYRange(new Range(yMin, yMax));
            this.dataManager.updateTickSpacing(this.chartTransform.modelXRange, new Range(yMin, yMax));
            this.dataManager.updateTrail();
          }
        }
      },

      up: (event) => {
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);

          if (activePointers.size < 2) {
            initialYDistance = null;
            initialYMidpoint = null;
          }
          if (activePointers.size === 0) {
            singleTouchStartY = null;
            initialYRange = null;
          }
        }
      },

      cancel: (event) => {
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);
          if (activePointers.size < 2) {
            initialYDistance = null;
            initialYMidpoint = null;
          }
          if (activePointers.size === 0) {
            singleTouchStartY = null;
            initialYRange = null;
          }
        }
      },
    });

    // Add mouse drag support for Y-axis panning
    let mouseDragStartY: number | null = null;
    let mouseDragInitialYRange: Range | null = null;

    const mouseDragListener = new DragListener({
      start: (event) => {
        mouseDragStartY = event.pointer.point.y;
        mouseDragInitialYRange = this.chartTransform.modelYRange.copy();
        this.dataManager.setManuallyZoomed(true);
      },

      drag: (event) => {
        if (mouseDragStartY !== null && mouseDragInitialYRange) {
          const deltaY = event.pointer.point.y - mouseDragStartY;

          // Convert delta to model coordinates
          const modelDeltaY = deltaY * (mouseDragInitialYRange.getLength() / this.graphHeight);

          const newYRange = new Range(
            mouseDragInitialYRange.min + modelDeltaY,
            mouseDragInitialYRange.max + modelDeltaY,
          );

          this.chartTransform.setModelYRange(newYRange);
          this.dataManager.updateTickSpacing(this.chartTransform.modelXRange, newYRange);
          this.dataManager.updateTrail();
        }
      },

      end: () => {
        mouseDragStartY = null;
        mouseDragInitialYRange = null;
      },
    });

    this.attach(this.yAxisInteractionRegion, mouseDragListener);

    // Make Y-axis interaction region pickable so it can receive input
    this.yAxisInteractionRegion.pickable = true;
    this.yAxisInteractionRegion.cursor = "ns-resize";

    // Add mouse wheel support for Y-axis zooming (zoom vertically only)
    this.attach(this.yAxisInteractionRegion, {
      wheel: (event) => {
        event.handle();
        const delta = event.domEvent?.deltaY;
        if (delta === undefined) {
          return;
        }

        // Get mouse position on Y-axis
        const mouseY = event.pointer.point.y;
        const viewMidpoint = new Vector2(this.graphWidth / 2, mouseY);
        const localMidpoint = this.chartRectangle.globalToLocalPoint(viewMidpoint);
        const modelCenterY = this.chartTransform.viewToModelPosition(localMidpoint).y;

        const currentRange = this.chartTransform.modelYRange;

        // Zoom in or out on Y-axis only
        const zoomFactor = delta < 0 ? this.zoomFactor : 1 / this.zoomFactor;

        // Calculate new Y range centered on mouse position
        const yMin = modelCenterY - (modelCenterY - currentRange.min) / zoomFactor;
        const yMax = modelCenterY + (currentRange.max - modelCenterY) / zoomFactor;

        const newYRange = new Range(yMin, yMax);

        this.chartTransform.setModelYRange(newYRange);
        this.dataManager.updateTickSpacing(this.chartTransform.modelXRange, newYRange);
        this.dataManager.updateTrail();
        this.dataManager.setManuallyZoomed(true);
      },
    });
  }

  /**
   * Setup touch controls for the X-axis (tick labels)
   * Allows pinch-to-zoom on X-axis only and one-finger drag for horizontal panning
   */
  private setupXAxisTouchControls(): void {
    // Track active touch pointers for X-axis
    const activePointers = new Map<Pointer, Vector2>();
    let initialXDistance: number | null = null;
    let initialXMidpoint: number | null = null;
    let initialXRange: Range | null = null;
    let singleTouchStartX: number | null = null;

    this.attach(this.xAxisInteractionRegion, {
      down: (event) => {
        if (event.pointer.type === "touch") {
          const globalPoint = event.pointer.point;
          activePointers.set(event.pointer, globalPoint);

          if (activePointers.size === 1) {
            // Single touch - prepare for horizontal pan
            singleTouchStartX = globalPoint.x;
            initialXRange = this.chartTransform.modelXRange.copy();
            this.dataManager.setManuallyZoomed(true);
          } else if (activePointers.size === 2) {
            // Two touches - prepare for pinch zoom on X-axis
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (point0 && point1) {
              initialXDistance = Math.abs(point0.x - point1.x);
              initialXMidpoint = (point0.x + point1.x) / 2;
              initialXRange = this.chartTransform.modelXRange.copy();
              singleTouchStartX = null; // Cancel single touch
              this.dataManager.setManuallyZoomed(true);
            }
          }
        }
      },

      move: (event) => {
        if (event.pointer.type === "touch" && activePointers.has(event.pointer)) {
          const globalPoint = event.pointer.point;
          activePointers.set(event.pointer, globalPoint);

          if (activePointers.size === 1 && singleTouchStartX !== null && initialXRange) {
            // Single touch - horizontal pan
            const deltaX = globalPoint.x - singleTouchStartX;

            // Convert delta to model coordinates
            const modelDeltaX = -deltaX * (initialXRange.getLength() / this.graphWidth);

            const newXRange = new Range(initialXRange.min + modelDeltaX, initialXRange.max + modelDeltaX);

            this.chartTransform.setModelXRange(newXRange);
            this.dataManager.updateTickSpacing(newXRange, this.chartTransform.modelYRange);
            this.dataManager.updateTrail();
          } else if (activePointers.size === 2 && initialXDistance && initialXMidpoint !== null && initialXRange) {
            // Two touches - pinch zoom on X-axis only
            const points = Array.from(activePointers.values());
            const point0 = points[0];
            const point1 = points[1];
            if (!(point0 && point1)) {
              return;
            }
            const currentXDistance = Math.abs(point0.x - point1.x);

            // Calculate zoom factor from X-distance ratio
            const zoomFactor = initialXDistance / currentXDistance;

            // Convert initial midpoint X to model coordinates
            const viewMidpoint = new Vector2(initialXMidpoint, this.graphHeight / 2);
            const localMidpoint = this.chartRectangle.globalToLocalPoint(viewMidpoint);
            const modelMidpointX = this.chartTransform.viewToModelPosition(localMidpoint).x;

            // Calculate new X range centered on the midpoint
            const xMin = modelMidpointX - (modelMidpointX - initialXRange.min) * zoomFactor;
            const xMax = modelMidpointX + (initialXRange.max - modelMidpointX) * zoomFactor;

            this.chartTransform.setModelXRange(new Range(xMin, xMax));
            this.dataManager.updateTickSpacing(new Range(xMin, xMax), this.chartTransform.modelYRange);
            this.dataManager.updateTrail();
          }
        }
      },

      up: (event) => {
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);

          if (activePointers.size < 2) {
            initialXDistance = null;
            initialXMidpoint = null;
          }
          if (activePointers.size === 0) {
            singleTouchStartX = null;
            initialXRange = null;
          }
        }
      },

      cancel: (event) => {
        if (event.pointer.type === "touch") {
          activePointers.delete(event.pointer);
          if (activePointers.size < 2) {
            initialXDistance = null;
            initialXMidpoint = null;
          }
          if (activePointers.size === 0) {
            singleTouchStartX = null;
            initialXRange = null;
          }
        }
      },
    });

    // Add mouse drag support for X-axis panning
    let mouseDragStartX: number | null = null;
    let mouseDragInitialXRange: Range | null = null;

    const mouseDragListener = new DragListener({
      start: (event) => {
        mouseDragStartX = event.pointer.point.x;
        mouseDragInitialXRange = this.chartTransform.modelXRange.copy();
        this.dataManager.setManuallyZoomed(true);
      },

      drag: (event) => {
        if (mouseDragStartX !== null && mouseDragInitialXRange) {
          const deltaX = event.pointer.point.x - mouseDragStartX;

          // Convert delta to model coordinates
          const modelDeltaX = -deltaX * (mouseDragInitialXRange.getLength() / this.graphWidth);

          const newXRange = new Range(
            mouseDragInitialXRange.min + modelDeltaX,
            mouseDragInitialXRange.max + modelDeltaX,
          );

          this.chartTransform.setModelXRange(newXRange);
          this.dataManager.updateTickSpacing(newXRange, this.chartTransform.modelYRange);
          this.dataManager.updateTrail();
        }
      },

      end: () => {
        mouseDragStartX = null;
        mouseDragInitialXRange = null;
      },
    });

    this.attach(this.xAxisInteractionRegion, mouseDragListener);

    // Make X-axis interaction region pickable so it can receive input
    this.xAxisInteractionRegion.pickable = true;
    this.xAxisInteractionRegion.cursor = "ew-resize";

    // Add mouse wheel support for X-axis zooming (zoom horizontally only)
    this.attach(this.xAxisInteractionRegion, {
      wheel: (event) => {
        event.handle();
        const delta = event.domEvent?.deltaY;
        if (delta === undefined) {
          return;
        }

        // Get mouse position on X-axis
        const mouseX = event.pointer.point.x;
        const viewMidpoint = new Vector2(mouseX, this.graphHeight / 2);
        const localMidpoint = this.chartRectangle.globalToLocalPoint(viewMidpoint);
        const modelCenterX = this.chartTransform.viewToModelPosition(localMidpoint).x;

        const currentRange = this.chartTransform.modelXRange;

        // Zoom in or out on X-axis only
        const zoomFactor = delta < 0 ? this.zoomFactor : 1 / this.zoomFactor;

        // Calculate new X range centered on mouse position
        const xMin = modelCenterX - (modelCenterX - currentRange.min) / zoomFactor;
        const xMax = modelCenterX + (currentRange.max - modelCenterX) / zoomFactor;

        const newXRange = new Range(xMin, xMax);

        this.chartTransform.setModelXRange(newXRange);
        this.dataManager.updateTickSpacing(newXRange, this.chartTransform.modelYRange);
        this.dataManager.updateTrail();
        this.dataManager.setManuallyZoomed(true);
      },
    });
  }

  /**
   * Setup drag functionality for the header bar to move the entire graph
   */
  private setupHeaderDrag(): void {
    let dragStartPosition: Vector2 | null = null;
    let dragStartPointerPoint: Vector2 | null = null;

    const dragListener = new DragListener({
      start: (event) => {
        // Record the starting position of the graph and pointer
        dragStartPosition = new Vector2(this.graphNode.x, this.graphNode.y);
        dragStartPointerPoint = event.pointer.point.copy();
        this.isDraggingProperty.value = true;
      },

      drag: (event) => {
        if (dragStartPosition && dragStartPointerPoint) {
          // Move the entire graph node
          const delta = event.pointer.point.minus(dragStartPointerPoint);
          this.graphNode.x = dragStartPosition.x + delta.x;
          this.graphNode.y = dragStartPosition.y + delta.y;
        }
      },

      end: () => {
        dragStartPosition = null;
        dragStartPointerPoint = null;
        this.isDraggingProperty.value = false;
      },
    });

    this.attach(this.headerBar, dragListener);
  }

  /**
   * Create and return resize handles for the graph corners
   */
  public createResizeHandles(): Rectangle[] {
    const handleSize = 12;
    const handleOffset = -6; // Center the handle on the corner

    // Define corner positions and cursors
    const corners = [
      { x: 0, y: 0, cursor: "nwse-resize" }, // Top-left
      { x: this.graphWidth, y: 0, cursor: "nesw-resize" }, // Top-right
      { x: 0, y: this.graphHeight, cursor: "nesw-resize" }, // Bottom-left
      { x: this.graphWidth, y: this.graphHeight, cursor: "nwse-resize" }, // Bottom-right
    ];

    corners.forEach((corner, index) => {
      const handle = new Rectangle(corner.x + handleOffset, corner.y + handleOffset, handleSize, handleSize, 2, 2, {
        fill: MotionSensorColors.panelBackgroundColorProperty,
        stroke: MotionSensorColors.panelBorderColorProperty,
        lineWidth: 2,
        cursor: corner.cursor,
      });

      this.resizeHandles.push(handle);
      this.setupResizeHandleDrag(handle, index);
    });

    return this.resizeHandles;
  }

  /**
   * Setup drag listener for a resize handle
   */
  private setupResizeHandleDrag(handle: Rectangle, cornerIndex: number): void {
    let dragStartGraphBounds: {
      width: number;
      height: number;
      x: number;
      y: number;
    } | null = null;
    let dragStartPointerPoint: Vector2 | null = null;

    const dragListener = new DragListener({
      start: (event) => {
        dragStartGraphBounds = {
          width: this.graphWidth,
          height: this.graphHeight,
          x: this.graphNode.x,
          y: this.graphNode.y,
        };
        dragStartPointerPoint = event.pointer.point.copy();
        this.isResizingProperty.value = true;
      },

      drag: (event) => {
        if (!(dragStartGraphBounds && dragStartPointerPoint)) {
          return;
        }

        const delta = event.pointer.point.minus(dragStartPointerPoint);
        let newWidth = dragStartGraphBounds.width;
        let newHeight = dragStartGraphBounds.height;
        let deltaX = 0;
        let deltaY = 0;

        // Minimum graph size
        const minWidth = 200;
        const minHeight = 150;

        // Handle different corners
        switch (cornerIndex) {
          case 0: // Top-left
            newWidth = Math.max(minWidth, dragStartGraphBounds.width - delta.x);
            newHeight = Math.max(minHeight, dragStartGraphBounds.height - delta.y);
            deltaX = dragStartGraphBounds.width - newWidth;
            deltaY = dragStartGraphBounds.height - newHeight;
            break;
          case 1: // Top-right
            newWidth = Math.max(minWidth, dragStartGraphBounds.width + delta.x);
            newHeight = Math.max(minHeight, dragStartGraphBounds.height - delta.y);
            deltaY = dragStartGraphBounds.height - newHeight;
            break;
          case 2: // Bottom-left
            newWidth = Math.max(minWidth, dragStartGraphBounds.width - delta.x);
            newHeight = Math.max(minHeight, dragStartGraphBounds.height + delta.y);
            deltaX = dragStartGraphBounds.width - newWidth;
            break;
          case 3: // Bottom-right
            newWidth = Math.max(minWidth, dragStartGraphBounds.width + delta.x);
            newHeight = Math.max(minHeight, dragStartGraphBounds.height + delta.y);
            break;
        }

        // Call the resize callback with new dimensions
        this.onResize(newWidth, newHeight);

        // Update position if needed (for top-left and bottom-left corners)
        if (deltaX !== 0 || deltaY !== 0) {
          this.graphNode.x = dragStartGraphBounds.x + deltaX;
          this.graphNode.y = dragStartGraphBounds.y + deltaY;
        }
      },

      end: () => {
        dragStartGraphBounds = null;
        dragStartPointerPoint = null;
        this.isResizingProperty.value = false;
      },
    });

    this.attach(handle, dragListener);
  }

  /**
   * Update graph dimensions (called when graph is resized)
   */
  public updateDimensions(width: number, height: number): void {
    this.graphWidth = width;
    this.graphHeight = height;
  }

  /**
   * Update resize handle positions after a resize
   */
  public updateResizeHandlePositions(): void {
    const handleOffset = -6;
    const corners = [
      { x: 0, y: 0 },
      { x: this.graphWidth, y: 0 },
      { x: 0, y: this.graphHeight },
      { x: this.graphWidth, y: this.graphHeight },
    ];

    this.resizeHandles.forEach((handle, index) => {
      const corner = corners[index];
      if (corner) {
        handle.setRect(corner.x + handleOffset, corner.y + handleOffset, 12, 12);
      }
    });
  }

  /**
   * Get resize handles array
   */
  public getResizeHandles(): Rectangle[] {
    return this.resizeHandles;
  }

  /**
   * Zoom the graph by a given factor, centered on a point
   * @param factor - Zoom factor (>1 zooms in, <1 zooms out)
   * @param centerPoint - Point to zoom around (in view coordinates)
   * @param setManualFlag - Whether to set the manual zoom flag (default: true)
   */
  private zoom(factor: number, centerPoint: Vector2, setManualFlag: boolean = true): void {
    if (setManualFlag) {
      this.dataManager.setManuallyZoomed(true);
    }

    const currentXRange = this.chartTransform.modelXRange;
    const currentYRange = this.chartTransform.modelYRange;

    // Convert center point from view to model coordinates
    const modelCenter = this.chartTransform.viewToModelPosition(centerPoint);

    // Calculate new ranges centered on the mouse position
    const xMin = modelCenter.x - (modelCenter.x - currentXRange.min) / factor;
    const xMax = modelCenter.x + (currentXRange.max - modelCenter.x) / factor;
    const yMin = modelCenter.y - (modelCenter.y - currentYRange.min) / factor;
    const yMax = modelCenter.y + (currentYRange.max - modelCenter.y) / factor;

    const newXRange = new Range(xMin, xMax);
    const newYRange = new Range(yMin, yMax);

    // Update chart transform
    this.chartTransform.setModelXRange(newXRange);
    this.chartTransform.setModelYRange(newYRange);

    // Update tick spacing
    this.dataManager.updateTickSpacing(newXRange, newYRange);

    // Update trail with new transform
    this.dataManager.updateTrail();
  }

  /**
   * Reset zoom to auto-scale mode
   */
  private resetZoom(): void {
    this.dataManager.setManuallyZoomed(false);

    // Recalculate axis ranges based on current data
    if (this.dataManager.getDataPointCount() > 1) {
      this.dataManager.updateAxisRanges();
    }
  }

  /**
   * Zoom in centered on the graph
   * Note: Does not disable auto-rescaling, allowing the graph to continue adjusting to new data
   */
  public zoomIn(): void {
    // Zoom centered on the middle of the chart
    const centerPoint = new Vector2(this.graphWidth / 2, this.graphHeight / 2);
    this.zoom(this.zoomFactor, centerPoint, false);
  }

  /**
   * Zoom out centered on the graph
   * Note: Does not disable auto-rescaling, allowing the graph to continue adjusting to new data
   */
  public zoomOut(): void {
    // Zoom out centered on the middle of the chart
    const centerPoint = new Vector2(this.graphWidth / 2, this.graphHeight / 2);
    this.zoom(1 / this.zoomFactor, centerPoint, false);
  }

  /**
   * Pan the graph in a given direction by 10% of the current range
   * Note: Does not disable auto-rescaling, allowing the graph to continue adjusting to new data
   */
  public pan(direction: "left" | "right" | "up" | "down"): void {
    const currentXRange = this.chartTransform.modelXRange;
    const currentYRange = this.chartTransform.modelYRange;

    // Pan by 10% of the current range
    const xDelta = (currentXRange.max - currentXRange.min) * 0.1;
    const yDelta = (currentYRange.max - currentYRange.min) * 0.1;

    let newXRange = currentXRange;
    let newYRange = currentYRange;

    switch (direction) {
      case "left":
        newXRange = new Range(currentXRange.min - xDelta, currentXRange.max - xDelta);
        break;
      case "right":
        newXRange = new Range(currentXRange.min + xDelta, currentXRange.max + xDelta);
        break;
      case "up":
        newYRange = new Range(currentYRange.min + yDelta, currentYRange.max + yDelta);
        break;
      case "down":
        newYRange = new Range(currentYRange.min - yDelta, currentYRange.max - yDelta);
        break;
    }

    // Update the chart transform
    this.chartTransform.setModelXRange(newXRange);
    this.chartTransform.setModelYRange(newYRange);

    // Update tick spacing
    this.dataManager.updateTickSpacing(newXRange, newYRange);

    // Update trail with new transform
    this.dataManager.updateTrail();
  }
}

// Register with namespace for debugging accessibility
MotionSensorNamespace.register("GraphInteractionHandler", GraphInteractionHandler);
