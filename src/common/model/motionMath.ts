/**
 * motionMath.ts
 *
 * Numerical helpers shared by the trace and the scorer. Pure functions with no
 * SceneryStack imports, so they are cheap to unit-test.
 */

/** One sample of a time series. */
export type Sample = {
  readonly time: number;
  readonly value: number;
};

/**
 * Least-squares slope of `points`, i.e. the best-fit derivative over the whole
 * window. Returns 0 when there are fewer than two points or the times are
 * degenerate, which is the right answer for a stationary or empty window and
 * avoids a division by zero at the ends of a trace.
 */
export function estimateDerivative(points: readonly Sample[]): number {
  const n = points.length;
  if (n < 2) {
    return 0;
  }

  let sumT = 0;
  let sumV = 0;
  for (const point of points) {
    sumT += point.time;
    sumV += point.value;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const dt = point.time - meanT;
    numerator += dt * (point.value - meanV);
    denominator += dt * dt;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Differentiates a uniformly sampled series with a centered least-squares
 * window of `windowSize` samples. Near the ends the window slides inward rather
 * than shrinking, so every sample gets a slope estimated from the same number
 * of points — a shrinking window would make the first and last samples much
 * noisier than the rest, exactly where a turnaround often is.
 */
export function differentiate(samples: readonly Sample[], windowSize: number): Sample[] {
  const n = samples.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    const only = samples[0];
    return only === undefined ? [] : [{ time: only.time, value: 0 }];
  }

  const width = Math.min(windowSize, n);
  const half = Math.floor(width / 2);

  return samples.map((sample, i) => {
    const start = Math.min(Math.max(i - half, 0), n - width);
    return { time: sample.time, value: estimateDerivative(samples.slice(start, start + width)) };
  });
}

/**
 * Causal derivative: each slope uses only the current and preceding samples.
 *
 * A slope is reported only once a full `windowSize` of *defined* input lies
 * behind it — inputs before `firstDefinedIndex` are a previous stage still
 * filling its own window. Until then the value is 0. A window that shrank at
 * the start instead would fit a line through two points, and a start-up is
 * exactly where one stale or zeroed reading makes that slope enormous.
 */
export function differentiateTrailing(samples: readonly Sample[], windowSize: number, firstDefinedIndex = 0): Sample[] {
  return samples.map((sample, index) => {
    const start = index - windowSize + 1;
    if (start < firstDefinedIndex) {
      return { time: sample.time, value: 0 };
    }
    return { time: sample.time, value: estimateDerivative(samples.slice(start, index + 1)) };
  });
}
