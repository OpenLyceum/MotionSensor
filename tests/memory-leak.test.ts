/**
 * Fleet-standard memory-leak regression suite (SceneryStackTemplate / QubitSketch pattern).
 *
 * Creates a disposable model object inside a function boundary, disposes it, forces
 * garbage collection via global.gc (--expose-gc in vitest.config.ts), then asserts via
 * WeakRef that the object was collected. V8 requires a function boundary (not merely
 * a block scope) so local strong references die when the helper returns.
 */

import { describe, expect, it } from "vitest";
import { MotionSensorModel } from "../src/common/model/MotionSensorModel.js";
import { PointerPositionSource } from "../src/common/model/PointerPositionSource.js";
import { PositionSourceType } from "../src/common/model/PositionSource.js";
import { SensorPositionSource } from "../src/common/model/SensorPositionSource.js";
import { describeDisposalLeaks, forceGC } from "./helpers/memoryLeak.js";

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

describeDisposalLeaks([
  { name: "PointerPositionSource", create: () => new PointerPositionSource() },
  { name: "SensorPositionSource", create: () => new SensorPositionSource() },
]);
