import { PLAY_AREA_NODE_SETTINGS } from "../../MotionSensorConstants.js";
/**
 * PlayAreaNode.ts
 *
 * The track the walker moves along: a 0–2 m strip with the motion sensor at the
 * origin, metre marks, and the figure itself.
 *
 * The two screens draw the same track. Only the figure differs — draggable on
 * the Simulation screen, sensor-driven on the other — so a student who has done
 * the mouse version recognises the sensor version immediately.
 */

import type { NumberProperty, TReadOnlyProperty } from "scenerystack/axon";
import { Shape } from "scenerystack/kite";
import { DragListener, KeyboardDragListener, Line, Node, Path, Rectangle, Text } from "scenerystack/scenery";
import { PhetFont } from "scenerystack/scenery-phet";
import MotionSensorColors from "../../MotionSensorColors.js";
import { POSITION_RANGE_M, TRACK_HEIGHT, WALKER_HEIGHT } from "../../MotionSensorConstants.js";
import { LinearTransform } from "./LinearTransform.js";
import { WalkerNode } from "./WalkerNode.js";

const TICK_LABEL_FONT = new PhetFont(PLAY_AREA_NODE_SETTINGS.TICK_LABEL_FONT_SIZE);

/** Pixels reserved at each end so the figure stays on the track at either limit. */
const EDGE_INSET: number = PLAY_AREA_NODE_SETTINGS.EDGE_INSET;

/** Baseline the figure stands on, measured from the top of the track. */
const GROUND_Y = TRACK_HEIGHT - 16;

export type PlayAreaNodeOptions = {
  readonly width: number;
  /** Where the figure is, in metres from the sensor. */
  readonly positionProperty: TReadOnlyProperty<number>;
  /**
   * Present only on the Simulation screen: the same property, writable, so a
   * drag can move the figure. Its absence is what makes the sensor screen's
   * figure read-only.
   */
  readonly writablePositionProperty?: NumberProperty;
  readonly walkerAccessibleName: TReadOnlyProperty<string>;
  readonly walkerAccessibleHelpText: TReadOnlyProperty<string>;
  /** Called when a drag begins, so the screen can start the run. */
  readonly onDragStart?: () => void;
  /**
   * Whether the figure has a real position to stand at. On the sensor screen a
   * disconnected sensor reads 0 m, which would park the figure inside the
   * sensor and imply a measurement that was never taken.
   */
  readonly hasPositionProperty?: TReadOnlyProperty<boolean>;
};

export class PlayAreaNode extends Node {
  /** The figure, exposed so the ScreenView can put it in the pdomOrder. */
  public readonly walkerNode: WalkerNode;

  private readonly disposePlayAreaNode: () => void;

  public constructor(providedOptions: PlayAreaNodeOptions) {
    super();

    const width = providedOptions.width;
    const transform = new LinearTransform(width, EDGE_INSET);
    const draggable = providedOptions.writablePositionProperty !== undefined;

    const track = new Rectangle(
      0,
      0,
      width,
      TRACK_HEIGHT,
      PLAY_AREA_NODE_SETTINGS.TRACK_CORNER_X,
      PLAY_AREA_NODE_SETTINGS.TRACK_CORNER_Y,
      {
        fill: MotionSensorColors.trackColorProperty,
      },
    );

    // Metre marks, labelled 0 through 4 — the same numbers as the chart's
    // position axis, so the two halves of the screen read as one system.
    const marks = new Node();
    for (let metres = POSITION_RANGE_M.min; metres <= POSITION_RANGE_M.max; metres += 1) {
      const x = transform.modelToViewX(metres);
      marks.addChild(
        new Line(x, GROUND_Y, x, GROUND_Y + 8, {
          stroke: MotionSensorColors.trackMarkColorProperty,
          lineWidth: 1,
        }),
      );
      marks.addChild(
        new Text(String(metres), {
          font: TICK_LABEL_FONT,
          fill: MotionSensorColors.trackMarkColorProperty,
          centerX: x,
          top: GROUND_Y + PLAY_AREA_NODE_SETTINGS.CONSTRUCTOR_TOP_OFFSET,
        }),
      );
    }

    const ground = new Line(0, GROUND_Y, width, GROUND_Y, {
      stroke: MotionSensorColors.trackMarkColorProperty,
      lineWidth: 1,
    });

    // The sensor sits at the origin and faces along the track, which is the
    // physical arrangement the activity sheet asks for.
    const sensorBody = new Rectangle(
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_X,
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_Y,
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_WIDTH,
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_HEIGHT,
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_CORNER_X,
      PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_CORNER_Y,
      {
        fill: MotionSensorColors.sensorBodyColorProperty,
        x: transform.modelToViewX(0),
        y: GROUND_Y - PLAY_AREA_NODE_SETTINGS.SENSOR_BODY_Y_OFFSET,
      },
    );
    const beam = new Path(
      new Shape()
        .moveTo(transform.modelToViewX(0) + 10, GROUND_Y - 14)
        .lineTo(width, GROUND_Y - 40)
        .lineTo(width, GROUND_Y + 12)
        .close(),
      { fill: MotionSensorColors.sensorBeamColorProperty },
    );

    this.walkerNode = new WalkerNode({
      accessibleName: providedOptions.walkerAccessibleName,
      accessibleHelpText: providedOptions.walkerAccessibleHelpText,
      draggable: draggable,
      ...(providedOptions.hasPositionProperty ? { visibleProperty: providedOptions.hasPositionProperty } : {}),
    });

    this.children = [track, beam, ground, marks, sensorBody, this.walkerNode];

    const positionListener = (metres: number) => {
      // Clamped for drawing only: a sensor reading with the sign flipped, or
      // zeroed from the far end of the room, is a real measurement that belongs
      // on the graph but has nowhere to stand on a 0-2 m track.
      this.walkerNode.centerX = transform.modelToViewX(POSITION_RANGE_M.constrainValue(metres));
      this.walkerNode.top = GROUND_Y - WALKER_HEIGHT;
    };
    providedOptions.positionProperty.link(positionListener);

    const writable = providedOptions.writablePositionProperty;
    const listeners: { dispose(): void }[] = [];

    if (writable !== undefined) {
      const setFromViewX = (viewX: number) => {
        writable.value = POSITION_RANGE_M.constrainValue(transform.viewToModelX(viewX));
      };

      const dragListener = new DragListener({
        start: () => providedOptions.onDragStart?.(),
        drag: (event) => {
          setFromViewX(this.walkerNode.globalToParentPoint(event.pointer.point).x);
        },
      });
      this.walkerNode.addInputListener(dragListener);
      listeners.push(dragListener);

      // Keyboard parity: the figure is the sim's primary input, so it has to be
      // fully operable without a pointer. Locked to the one axis it can move on.
      const keyboardDragListener = new KeyboardDragListener({
        keyboardDragDirection: "leftRight",
        dragSpeed: 300,
        shiftDragSpeed: 100,
        start: () => providedOptions.onDragStart?.(),
        drag: (_event, listener) => {
          writable.value = POSITION_RANGE_M.constrainValue(
            writable.value + listener.modelDelta.x / transform.pixelsPerMetre,
          );
        },
      });
      this.walkerNode.addInputListener(keyboardDragListener);
      listeners.push(keyboardDragListener);
    }

    this.disposePlayAreaNode = () => {
      providedOptions.positionProperty.unlink(positionListener);
      for (const listener of listeners) {
        listener.dispose();
      }
    };
  }

  public override dispose(): void {
    this.disposePlayAreaNode();
    super.dispose();
  }
}
