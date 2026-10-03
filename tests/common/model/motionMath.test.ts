/**
 * The numerical helpers underneath the velocity trace.
 */

import { describe, expect, it } from "vitest";
import {
  differentiate,
  differentiateTrailing,
  estimateDerivative,
  type Sample,
} from "../../../src/common/model/motionMath.js";

function ramp(slope: number, count: number, dt = 0.05): Sample[] {
  return Array.from({ length: count }, (_, i) => ({ time: i * dt, value: slope * i * dt }));
}

describe("estimateDerivative", () => {
  it("recovers the slope of a straight line", () => {
    expect(estimateDerivative(ramp(3, 5))).toBeCloseTo(3, 10);
  });

  it("returns 0 for a stationary window", () => {
    expect(estimateDerivative(ramp(0, 5))).toBe(0);
  });

  it("returns 0 rather than dividing by zero on a degenerate window", () => {
    expect(estimateDerivative([{ time: 1, value: 5 }])).toBe(0);
    expect(estimateDerivative([])).toBe(0);
    expect(
      estimateDerivative([
        { time: 1, value: 5 },
        { time: 1, value: 7 },
      ]),
    ).toBe(0);
  });
});

describe("differentiate", () => {
  it("returns one value per input sample", () => {
    expect(differentiate(ramp(2, 20), 5)).toHaveLength(20);
  });

  it("recovers a constant slope everywhere, including at the ends", () => {
    for (const { value } of differentiate(ramp(2, 20), 5)) {
      expect(value).toBeCloseTo(2, 8);
    }
  });

  it("keeps the sample times of the input", () => {
    const input = ramp(2, 6);
    const output = differentiate(input, 5);
    expect(output.map((s) => s.time)).toEqual(input.map((s) => s.time));
  });

  it("handles inputs shorter than the window", () => {
    expect(differentiate(ramp(2, 2), 5)).toHaveLength(2);
    expect(differentiate(ramp(2, 1), 5)[0]?.value).toBe(0);
    expect(differentiate([], 5)).toEqual([]);
  });

  it("follows a changing slope", () => {
    // v(t) = 2t for x(t) = t², sampled at 20 Hz.
    const parabola: Sample[] = Array.from({ length: 41 }, (_, i) => {
      const t = i * 0.05;
      return { time: t, value: t * t };
    });
    const velocity = differentiate(parabola, 5);
    // Check in the interior, where the window is genuinely centered.
    for (let i = 5; i < 36; i++) {
      const sample = velocity[i];
      expect(sample).toBeDefined();
      if (sample !== undefined) {
        expect(sample.value).toBeCloseTo(2 * sample.time, 2);
      }
    }
  });
});

describe("differentiateTrailing", () => {
  it("reads 0 until a full window lies behind the sample, then recovers the slope", () => {
    const velocity = differentiateTrailing(ramp(2, 10), 4);
    expect(velocity.slice(0, 3).map((s) => s.value)).toEqual([0, 0, 0]);
    for (const { value } of velocity.slice(3)) {
      expect(value).toBeCloseTo(2, 8);
    }
  });

  it("never fits a line through fewer points than the window", () => {
    // One stale first reading, then a student standing still: a two-point
    // slope would report a huge velocity at the second sample.
    const input: Sample[] = [{ time: 0, value: 1.2 }, ...ramp(0, 5).slice(1)];
    expect(differentiateTrailing(input, 4)[1]?.value).toBe(0);
  });

  it("waits for the previous stage to fill before its own window counts", () => {
    const velocity = differentiateTrailing(ramp(2, 10), 3, 2);
    // Window [start, index] must start at or after index 2, so index 4 is first.
    expect(velocity.slice(0, 4).map((s) => s.value)).toEqual([0, 0, 0, 0]);
    expect(velocity[4]?.value).toBeCloseTo(2, 8);
  });

  it("keeps the sample times of the input", () => {
    const input = ramp(2, 6);
    expect(differentiateTrailing(input, 3).map((s) => s.time)).toEqual(input.map((s) => s.time));
  });
});
