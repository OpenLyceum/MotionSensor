/**
 * PointerPositionSource.ts
 *
 * The Simulation screen's source: the walker's position, written directly by
 * whatever is dragging it (mouse, touch, or keyboard).
 *
 * There is no physics here on purpose. The student *is* the motion — the point
 * of the exercise is that their own hand movement produces the graph, exactly
 * as their own walking does on the sensor screen.
 */

import { BooleanProperty, NumberProperty, type TReadOnlyProperty } from "scenerystack/axon";
import { POSITION_RANGE_M } from "../../MotionSensorConstants.js";
import MotionSensorNamespace from "../../MotionSensorNamespace.js";
import { PositionSourceType, type PositionSourceTypeValue, type TPositionSource } from "./PositionSource.js";

/** Where the walker starts, in metres — a comfortable distance from the sensor. */
const INITIAL_POSITION_M = 1;

export class PointerPositionSource implements TPositionSource {
  public readonly sourceType: PositionSourceTypeValue = PositionSourceType.POINTER;

  /** Writable within the model layer; exposed read-only through the contract. */
  public readonly walkerPositionProperty: NumberProperty;

  private readonly availableProperty: BooleanProperty;

  public constructor() {
    this.walkerPositionProperty = new NumberProperty(INITIAL_POSITION_M, {
      range: POSITION_RANGE_M,
      units: "m",
    });
    // A pointer is always there; the property exists so both sources satisfy
    // the same contract and the view never branches on source type to decide
    // whether a run may start.
    this.availableProperty = new BooleanProperty(true);
  }

  public get positionProperty(): TReadOnlyProperty<number> {
    return this.walkerPositionProperty;
  }

  public get isAvailableProperty(): TReadOnlyProperty<boolean> {
    return this.availableProperty;
  }

  public startSampling(): void {
    // Pointer position is already updated directly by input listeners.
  }

  public stopSampling(): void {
    // Pointer position requires no acquisition to stop.
  }

  /** Always: the walker is wherever the pointer last put it, right now. */
  public hasFreshReading(): boolean {
    return true;
  }

  /** No-op: the walker moves only when the student moves it. */
  public step(_dt: number): void {
    // intentionally empty
  }

  public reset(): void {
    this.walkerPositionProperty.reset();
  }

  public dispose(): void {
    this.walkerPositionProperty.dispose();
    this.availableProperty.dispose();
  }
}

MotionSensorNamespace.register("PointerPositionSource", PointerPositionSource);
