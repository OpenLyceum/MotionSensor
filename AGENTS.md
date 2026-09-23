# AGENTS.md — Motion Sensor

Sim-specific context for AI assistants. General SceneryStack guidance:
[OpenLyceum/.github/AGENTS.md](https://github.com/OpenLyceum/.github/blob/main/AGENTS.md).

## Project

Record position over time and plot it on a graph whose axes the student chooses
— with the mouse on the **Simulation** screen, or in front of a PASCO Wireless
Motion Sensor (PS-3219) over Web Bluetooth on the **Motion Sensor** screen. The
same recording can be read as a table of two columns and downloaded as CSV.
A data logger, not a game: there is no target curve and no score.

Architecture and rationale live in [`doc/implementation-notes.md`](doc/implementation-notes.md);
the sampling clock and the derivative chain are in [`doc/model.md`](doc/model.md).
Read both before changing model code.

## Key files

| File | Purpose |
|---|---|
| `src/common/model/MotionSensorModel.ts` | The whole activity: recording state machine, fixed-rate sampling, derived quantities |
| `src/common/model/Trace.ts` | The sample buffer + cached velocity / acceleration series |
| `src/common/model/motionMath.ts` | Least-squares derivative + windowed differentiator (pure) |
| `src/common/model/PositionSource.ts` | `TPositionSource` — the seam between the two screens |
| `src/common/model/SensorPositionSource.ts` | The PASCO link: lazy device, poll loop, never-rejecting connect |
| `src/common/view/MotionSensorScreenView.ts` | **One** ScreenView, used by both screens |
| `src/common/view/graph/` | `ConfigurableGraph` and its data manager, controls panel and gesture handler |
| `src/common/view/DataTableNode.ts` | The recording as two chosen columns, scrolling + CSV download |
| `src/common/view/dataTableCsv.ts` | CSV text from those columns (pure) |
| `src/common/view/SensorOptionsPanel.ts` | Change sign, zero at start / now, remove offset, range |
| `src/common/model/sensorMeasurement.ts` | Range gate + zero/sign arithmetic (pure) |
| `src/common/view/PlayAreaNode.ts` | Track, sensor, walker + drag / keyboard listeners |
| `src/simulation/`, `src/sensor/` | Thin screen packages; the models are ten lines each |

## The two screens are one view

`SimulationModel` and `SensorModel` differ only in which `TPositionSource` they
construct, and both screens instantiate the same `MotionSensorScreenView`. Two
options carry the entire difference: `writablePositionProperty` (makes the
walker draggable) and `sensorSource` (adds the connection panel). **Do not fork
the view.** A student should recognise the sensor screen instantly, and sameness
by construction is the only way to guarantee that.

## The graph

`src/common/view/graph/` is a **copy-fork**, not a shared library. The same
component lives in OscillationsAndChaos, Resonance, ACPhasor and TrackLab, each
drifted from the others; this copy came from ACPhasor's (which has real
`dispose()` support) with OscillationsAndChaos's accessibility work — button
accessible names and the spoken axis-change announcement — added back. Fixes
worth having elsewhere have to be ported by hand.

Two things about it are specific to this sim:

- **It is fed from `model.sampleEmitter`, not from `step()`.** The sims it came
  from call `addDataPoint()` once per animation frame, which spaces points by
  frame time. Here the model owns a fixed clock, at the rate the student chose,
  and the view listens to it, so the same walk plots identically at 60 and
  144 Hz.
- **Changing an axis *replots*, it does not clear.** Upstream blanks the graph,
  which is fine when the sim regenerates data every frame and useless for a
  one-shot recording. Each `PlottableProperty` here carries a `samples` accessor
  and `ConfigurableGraph.replot()` rebuilds the series from those, so one
  recording can be read on several pairs of axes. The series must stay
  index-aligned — they all come off the same clock.

## Things that will bite

- **Web Bluetooth needs a user gesture** — `requestDevice()` must be reached
  directly from the Connect button. Do not add an `await` ahead of it.
- **`connect()` never rejects.** Outcomes land on Properties. A dismissed picker
  throws `DeviceSelectionCancelled` internally and is not shown as an error.
- **Never accumulate recording time in a float.** Sample times are
  `index × period`; tests pin it.
- **The sample rate is a student's choice, captured at Record.** Never read
  `sampleRateProperty` per tick, and never count a derivative window in samples:
  `windowSamplesForRate()` turns 0.2 s into samples so the same walk reads as the
  same speed at 5 Hz and at 50 Hz.
- **The table and the graph share one plottable list.** Feed
  `DataTableNode` the array the graph gets; two lists would let a name mean
  different series in the two places.
- **Sensor Range is a host-side filter, not a device command.** PASCO's config
  opcodes are not in `PascoMotionProtocol.ts` — do not invent one. See
  `SensorRange.ts`.
- **`dispose()` must stay idempotent** — axon Properties throw on double
  dispose, and the memory-leak suite disposes twice on purpose. The ScreenView
  disposes the graph explicitly; the graph is not a plain child.
- **`positionProperty` has two owners.** While idle it mirrors the source; while
  recording the fixed clock writes it, so the value the graph samples is the one
  that went into the trace. Changing that split will desynchronise them.
- **`ScreenView` throws if you set `pdomOrder` on itself** — it lives on a
  wrapper `Node`.
- **Preferences dialog is always light** — use `controlSurfaceTextColorProperty`
  there, never `textColorProperty`.
- **`LocalizedString` suffixes every leaf key**: `axes.position` is
  `axes.positionStringProperty`. Getting it wrong renders the literal
  `undefined`.

## Compliance carve-outs

### `package.json` overrides

Inherited from the template; rationale unchanged (`lodash`, `three`,
`brace-expansion` pinned for advisories SceneryStack has not yet re-pinned).
Dependabot ignores those three names.

## Hardware testing

Needs a PS-3219, Chrome/Edge/Opera, and HTTPS or `localhost`. There is no way to
exercise the transport in CI, which is why everything above it is pure and unit
tested.

```bash
npm start   # then open the Motion Sensor screen
```

`?showDiagnostics=true` prints the device's measurement list and the raw value
of every measurement each poll — the way to tell a genuine zero reading
(nothing within 0.15–4 m to echo off) from a device answering nothing at all.
`?pollIntervalMs=` raises the poll period when debugging a flaky link.

## Commands

```bash
npm run lint && npm run check && npm run build && npm test
```

`npm run test:fuzz:quick` after any change to the sensor path — it is the only
check that constructs both screens in a real browser.
