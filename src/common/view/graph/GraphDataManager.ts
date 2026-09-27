/**
 * GraphDataManager.ts
 *
 * The data behind {@link ConfigurableGraph}: a bounded ring of points, the
 * auto-scaling of both axis ranges to fit them, tick spacing, and the fading
 * trail drawn over the most recent few. Split out so the graph node itself is
 * about layout and interaction rather than bookkeeping.
 *
 * Ported alongside ConfigurableGraph; colors and namespace remapped.
 */

import type { ChartTransform, GridLineSet, LinePlot, TickLabelSet, TickMarkSet } from "scenerystack/bamboo";
import { Range, Vector2 } from "scenerystack/dot";
import { Circle, type Node } from "scenerystack/scenery";
import MotionSensorColors from "../../../MotionSensorColors.js";
import MotionSensorNamespace from "../../../MotionSensorNamespace.js";

// Trail dot appearance: the oldest dot in the trail is small and faint, the
// newest large and nearly opaque, so the trail reads as a direction of travel.
const TRAIL_MIN_RADIUS = 3;
const TRAIL_MAX_RADIUS = 5;
const TRAIL_MIN_OPACITY = 0.2;
const TRAIL_MAX_OPACITY = 0.8;

/**
 * Configuration for grid lines, tick marks, and tick labels
 */
export interface GridVisualizationConfig {
  verticalGridLineSet: GridLineSet;
  horizontalGridLineSet: GridLineSet;
  xTickMarkSet: TickMarkSet;
  yTickMarkSet: TickMarkSet;
  xTickLabelSet: TickLabelSet;
  yTickLabelSet: TickLabelSet;
}

export class GraphDataManager {
  private readonly dataPoints: Vector2[] = [];
  private readonly maxDataPoints: number;
  private readonly chartTransform: ChartTransform;
  private readonly linePlot: LinePlot;
  private readonly trailNode: Node;
  private readonly trailLength: number = 5;
  /**
   * The trail dots, built once and thereafter only moved, resized and hidden.
   * {@link updateTrail} runs every frame the graph is visible, so it must not
   * allocate — same reason {@link CapacitorNode} pre-builds its charge symbols.
   */
  private readonly trailDots: Circle[] = [];
  private isManuallyZoomed: boolean = false;

  // Grid and tick components
  private readonly verticalGridLineSet: GridLineSet;
  private readonly horizontalGridLineSet: GridLineSet;
  private readonly xTickMarkSet: TickMarkSet;
  private readonly yTickMarkSet: TickMarkSet;
  private readonly xTickLabelSet: TickLabelSet;
  private readonly yTickLabelSet: TickLabelSet;

  public constructor(
    chartTransform: ChartTransform,
    linePlot: LinePlot,
    trailNode: Node,
    maxDataPoints: number,
    gridConfig: GridVisualizationConfig,
  ) {
    this.chartTransform = chartTransform;
    this.linePlot = linePlot;
    this.trailNode = trailNode;
    this.maxDataPoints = maxDataPoints;
    this.verticalGridLineSet = gridConfig.verticalGridLineSet;
    this.horizontalGridLineSet = gridConfig.horizontalGridLineSet;
    this.xTickMarkSet = gridConfig.xTickMarkSet;
    this.yTickMarkSet = gridConfig.yTickMarkSet;
    this.xTickLabelSet = gridConfig.xTickLabelSet;
    this.yTickLabelSet = gridConfig.yTickLabelSet;

    for (let i = 0; i < this.trailLength; i++) {
      const dot = new Circle(TRAIL_MAX_RADIUS, {
        fill: MotionSensorColors.traceColorProperty,
        visible: false,
      });
      this.trailDots.push(dot);
      this.trailNode.addChild(dot);
    }
  }

  /**
   * Add a new data point to the graph
   */
  public addDataPoint(xValue: number, yValue: number): void {
    // Skip invalid values
    if (!(Number.isFinite(xValue) && Number.isFinite(yValue))) {
      return;
    }

    // Add point
    this.dataPoints.push(new Vector2(xValue, yValue));

    // Remove oldest point if we exceed max
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints.shift();
    }

    // Update the line plot
    this.linePlot.setDataSet(this.dataPoints);

    // Auto-scale the axes if we have data and user hasn't manually zoomed
    if (this.dataPoints.length > 1 && !this.isManuallyZoomed) {
      this.updateAxisRanges();
    }

    // Update the trail visualization
    this.updateTrail();
  }

  /**
   * Add multiple data points at once.
   * More efficient than calling addDataPoint repeatedly.
   * @param points - Array of {x, y} value pairs
   */
  public addDataPoints(points: Array<{ x: number; y: number }>): void {
    if (points.length === 0) {
      return;
    }

    // Add all valid points
    for (const { x, y } of points) {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.dataPoints.push(new Vector2(x, y));
      }
    }

    // Remove oldest points if we exceed max
    while (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints.shift();
    }

    // Update the line plot
    this.linePlot.setDataSet(this.dataPoints);

    // Auto-scale the axes if we have data and user hasn't manually zoomed
    if (this.dataPoints.length > 1 && !this.isManuallyZoomed) {
      this.updateAxisRanges();
    }

    // Update the trail visualization
    this.updateTrail();
  }

  /**
   * Clear all data points
   */
  public clearData(): void {
    this.dataPoints.length = 0;
    this.linePlot.setDataSet([]);

    // Reset to default ranges
    const defaultRange = new Range(-10, 10);
    this.chartTransform.setModelXRange(defaultRange);
    this.chartTransform.setModelYRange(defaultRange);

    // Reset tick spacing
    this.updateTickSpacing(defaultRange, defaultRange);

    // Clear trail (the dots are pooled — hide them, do not discard them)
    for (const dot of this.trailDots) {
      dot.visible = false;
    }

    // Reset zoom state
    this.isManuallyZoomed = false;
  }

  /**
   * Update axis ranges to fit all data with some padding
   */
  public updateAxisRanges(): void {
    const firstPoint = this.dataPoints[0];
    if (this.dataPoints.length === 0 || !firstPoint) {
      return;
    }

    let xMin = firstPoint.x;
    let xMax = firstPoint.x;
    let yMin = firstPoint.y;
    let yMax = firstPoint.y;

    for (const point of this.dataPoints) {
      xMin = Math.min(xMin, point.x);
      xMax = Math.max(xMax, point.x);
      yMin = Math.min(yMin, point.y);
      yMax = Math.max(yMax, point.y);
    }

    // Add 10% padding with a minimum to ensure reasonable range sizes
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;

    // Use 10% padding but ensure a minimum range of 2 units
    const xPadding = Math.max(xSpan * 0.1, (2 - xSpan) / 2, 0.1);
    const yPadding = Math.max(ySpan * 0.1, (2 - ySpan) / 2, 0.1);

    const xRange = new Range(xMin - xPadding, xMax + xPadding);
    const yRange = new Range(yMin - yPadding, yMax + yPadding);

    this.chartTransform.setModelXRange(xRange);
    this.chartTransform.setModelYRange(yRange);

    // Update tick spacing for better readability
    this.updateTickSpacing(xRange, yRange);
  }

  /**
   * Update tick spacing based on the range
   */
  public updateTickSpacing(xRange: Range, yRange: Range): void {
    // Calculate appropriate tick spacing (aim for ~5 ticks to avoid clutter)
    const xSpacing = GraphDataManager.calculateTickSpacing(xRange.getLength());
    const ySpacing = GraphDataManager.calculateTickSpacing(yRange.getLength());

    this.verticalGridLineSet.setSpacing(ySpacing);
    this.horizontalGridLineSet.setSpacing(xSpacing);
    this.xTickMarkSet.setSpacing(xSpacing);
    this.yTickMarkSet.setSpacing(ySpacing);
    this.xTickLabelSet.setSpacing(xSpacing);
    this.yTickLabelSet.setSpacing(ySpacing);
  }

  /**
   * Calculate appropriate tick spacing for a given range.
   * This is a static utility method that doesn't depend on instance state.
   */
  public static calculateTickSpacing(rangeLength: number): number {
    // Handle edge cases
    if (!Number.isFinite(rangeLength) || rangeLength <= 0) {
      return 1;
    }

    // Target ~5-6 ticks to avoid too many grid lines
    const targetTicks = 5;
    const roughSpacing = rangeLength / targetTicks;

    // Handle very small spacings
    if (roughSpacing < 1e-10) {
      return 1e-10;
    }

    // Round to a nice number (1, 2, 5, 10, 20, 50, etc.)
    const magnitude = 10 ** Math.floor(Math.log10(roughSpacing));
    const residual = roughSpacing / magnitude;

    let spacing: number;
    if (residual <= 1.5) {
      spacing = magnitude;
    } else if (residual <= 3.5) {
      spacing = 2 * magnitude;
    } else if (residual <= 7.5) {
      spacing = 5 * magnitude;
    } else {
      spacing = 10 * magnitude;
    }

    // Ensure minimum spacing to prevent too many ticks
    return Math.max(spacing, rangeLength / 20);
  }

  /**
   * Update the trail visualization showing the most recent points.
   *
   * Called once per frame while the graph is visible (and again on every zoom,
   * pan and resize), so it reuses the pooled dots rather than rebuilding them:
   * unused ones are simply hidden.
   */
  public updateTrail(): void {
    // Get the last N points (up to trailLength)
    const numTrailPoints = Math.min(this.trailLength, this.dataPoints.length);

    // Start from the most recent points
    const startIndex = this.dataPoints.length - numTrailPoints;

    this.trailDots.forEach((dot, i) => {
      const point = i < numTrailPoints ? this.dataPoints[startIndex + i] : undefined;
      if (!point) {
        dot.visible = false;
        return;
      }

      // Age of this point within the trail: 0 is the oldest, 1 the newest.
      const fraction = i / (numTrailPoints - 1 || 1);

      // Size and opacity increase with recency
      // Oldest point: small and transparent
      // Newest point: large and opaque
      dot.radius = TRAIL_MIN_RADIUS + (TRAIL_MAX_RADIUS - TRAIL_MIN_RADIUS) * fraction;
      dot.opacity = TRAIL_MIN_OPACITY + (TRAIL_MAX_OPACITY - TRAIL_MIN_OPACITY) * fraction;

      // Transform model coordinates to view coordinates
      dot.center = this.chartTransform.modelToViewPosition(point);
      dot.visible = true;
    });
  }

  /**
   * Set the manually zoomed flag (called by interaction handlers)
   */
  public setManuallyZoomed(value: boolean): void {
    this.isManuallyZoomed = value;
  }

  /**
   * Get the manually zoomed state
   */
  public isManualZoom(): boolean {
    return this.isManuallyZoomed;
  }

  /**
   * Get the number of data points
   */
  public getDataPointCount(): number {
    return this.dataPoints.length;
  }
}

// Register with namespace for debugging accessibility
MotionSensorNamespace.register("GraphDataManager", GraphDataManager);
