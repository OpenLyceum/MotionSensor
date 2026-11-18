/**
 * Fleet-standard memory-leak regression suite (SceneryStackTemplate / QubitSketch pattern).
 *
 * Creates a disposable model object inside a function boundary, disposes it, forces
 * garbage collection via global.gc (--expose-gc in vitest.config.ts), then asserts via
 * WeakRef that the object was collected. V8 requires a function boundary (not merely
 * a block scope) so local strong references die when the helper returns.
 */

import { BooleanProperty, Property } from "scenerystack/axon";
import { Node } from "scenerystack/scenery";
import { describe, expect, it } from "vitest";
import { MotionSensorModel } from "../src/common/model/MotionSensorModel.js";
import { PointerPositionSource } from "../src/common/model/PointerPositionSource.js";
import { PositionSourceType } from "../src/common/model/PositionSource.js";
import { SensorPositionSource } from "../src/common/model/SensorPositionSource.js";
import { DataTableNode } from "../src/common/view/DataTableNode.js";
import { ConfigurableGraph } from "../src/common/view/graph/ConfigurableGraph.js";
import { GraphControlsPanel } from "../src/common/view/graph/GraphControlsPanel.js";
import type { PlottableProperty } from "../src/common/view/graph/PlottableProperty.js";
import { PlayAreaNode } from "../src/common/view/PlayAreaNode.js";
import { StringManager } from "../src/i18n/StringManager.js";
import { MotionSensorPreferencesModel } from "../src/preferences/MotionSensorPreferencesModel.js";
import { SensorModel } from "../src/sensor/model/SensorModel.js";
import { SensorScreenSummaryContent } from "../src/sensor/view/SensorScreenSummaryContent.js";
import { SimulationModel } from "../src/simulation/model/SimulationModel.js";
import { SimulationScreenSummaryContent } from "../src/simulation/view/SimulationScreenSummaryContent.js";
import { describeDisposalLeaks, expectNoListenerGrowth, forceGC } from "./helpers/memoryLeak.js";

function createAndDisposeModel(): WeakRef<object> {
  const model = new MotionSensorModel({
    sourceType: PositionSourceType.POINTER,
    source: new PointerPositionSource(),
  });
  const ref = new WeakRef<object>(model);
  model.dispose();
  return ref;
}

describe("Memory leak regression", () => {
  it("MotionSensorModel is collected after dispose", async () => {
    const ref = createAndDisposeModel();
    await forceGC(ref);
    expect(ref.deref()).toBeUndefined();
  });

  it("double dispose() does not throw", () => {
    const model = new MotionSensorModel({
      sourceType: PositionSourceType.POINTER,
      source: new PointerPositionSource(),
    });
    model.dispose();
    expect(() => model.dispose()).not.toThrow();
  });

  it("repeated create/dispose cycles leave no survivors", async () => {
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < 10; i++) {
      refs.push(createAndDisposeModel());
    }
    await forceGC(refs);
    const survivors = refs.filter((r) => r.deref() !== undefined).length;
    expect(survivors).toBe(0);
  });
});

const preferences = new MotionSensorPreferencesModel();
const pointerModel = new MotionSensorModel({
  sourceType: PositionSourceType.POINTER,
  source: new PointerPositionSource(),
});
const simulationModel = new SimulationModel(preferences);
const sensorModel = new SensorModel(preferences);
const walkerNameProperty = new Property("Walker");
const walkerHelpProperty = new Property("Drag the walker");
const graphPlotA: PlottableProperty = { name: "Time", property: new Property(0), unit: "s" };
const graphPlotB: PlottableProperty = { name: "Position", property: new Property(1), unit: "m" };
const graphXProperty = new Property(graphPlotA);
const graphYProperty = new Property(graphPlotB);

// The graph and data table are built as MotionSensorScreenView builds them: against the
// screen model, localized axis names and a shared combo-box list parent, all of which outlive them.
const axesStrings = StringManager.getInstance().getAxesStrings();
const tableStrings = StringManager.getInstance().getTableStrings();
const graphA11yStrings = StringManager.getInstance().getGraphA11yStrings();
const viewPlottables: PlottableProperty[] = [
  {
    name: axesStrings.positionStringProperty,
    property: pointerModel.positionProperty,
    unit: "m",
    samples: () => pointerModel.getPositionSeries(),
  },
  {
    name: axesStrings.timeStringProperty,
    property: pointerModel.timeProperty,
    unit: "s",
    samples: () => pointerModel.getTimeSeries(),
  },
];
const viewListParent = new Node();
const showTableProperty = new BooleanProperty(true);

/** Sim-lifetime string, accessible-name and model Properties the data table links to. */
const dataTableLinkedProperties: readonly object[] = [
  axesStrings.positionStringProperty,
  axesStrings.timeStringProperty,
  tableStrings.columnAStringProperty,
  tableStrings.columnBStringProperty,
  tableStrings.scrollUpStringProperty,
  tableStrings.scrollDownStringProperty,
  tableStrings.rowsPatternStringProperty,
  tableStrings.emptyStringProperty,
  tableStrings.downloadStringProperty,
  tableStrings.headerPatternStringProperty,
  pointerModel.traceChangedProperty,
  showTableProperty,
];

/** Sim-lifetime string and accessible-name Properties the graph links to. */
const graphLinkedProperties: readonly object[] = [
  axesStrings.positionStringProperty,
  axesStrings.timeStringProperty,
  graphA11yStrings.rescaleStringProperty,
  graphA11yStrings.zoomInStringProperty,
  graphA11yStrings.zoomOutStringProperty,
  graphA11yStrings.panLeftStringProperty,
  graphA11yStrings.panRightStringProperty,
  graphA11yStrings.panUpStringProperty,
  graphA11yStrings.panDownStringProperty,
];

const createDataTable = () =>
  new DataTableNode({
    model: pointerModel,
    plottableProperties: viewPlottables,
    listParent: viewListParent,
    visibleProperty: showTableProperty,
  });
const createGraph = () =>
  new ConfigurableGraph(viewPlottables, viewPlottables[1]!, viewPlottables[0]!, 400, 300, viewListParent);

describeDisposalLeaks([
  { name: "PointerPositionSource", create: () => new PointerPositionSource() },
  { name: "SensorPositionSource", create: () => new SensorPositionSource() },
  {
    name: "SimulationScreenSummaryContent",
    create: () => new SimulationScreenSummaryContent(simulationModel),
    keepAlive: () => [simulationModel],
  },
  {
    name: "SensorScreenSummaryContent",
    create: () => new SensorScreenSummaryContent(sensorModel),
    keepAlive: () => [sensorModel],
  },
  {
    name: "GraphControlsPanel",
    create: () => new GraphControlsPanel([graphPlotA, graphPlotB], graphXProperty, graphYProperty, 300),
    keepAlive: () => [graphXProperty, graphYProperty, graphPlotA.property, graphPlotB.property],
  },
  {
    name: "PlayAreaNode",
    create: () =>
      new PlayAreaNode({
        width: 500,
        positionProperty: pointerModel.positionProperty,
        walkerAccessibleName: walkerNameProperty,
        walkerAccessibleHelpText: walkerHelpProperty,
      }),
    keepAlive: () => [pointerModel, walkerNameProperty, walkerHelpProperty],
  },
  {
    name: "DataTableNode",
    create: createDataTable,
    keepAlive: () => [pointerModel, viewListParent, ...dataTableLinkedProperties],
  },
  {
    name: "ConfigurableGraph",
    create: createGraph,
    keepAlive: () => [pointerModel, viewListParent, ...graphLinkedProperties],
  },
]);

describe("graph and data table leave no listeners on string, accessible-name or model Properties", () => {
  it("DataTableNode", async () => {
    await expectNoListenerGrowth(dataTableLinkedProperties, () => {
      createDataTable().dispose();
    });
  });

  it("ConfigurableGraph", async () => {
    await expectNoListenerGrowth(graphLinkedProperties, () => {
      createGraph().dispose();
    });
  });
});
