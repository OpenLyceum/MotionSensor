# Motion Sensor

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

Record how something moves and read the result off a graph you configure
yourself — with the mouse on one screen, or by walking in front of a PASCO
Wireless Motion Sensor over Web Bluetooth or USB on the other. Position, velocity and
acceleration are all measured from the same motion, so the relationships between
them are something you discover rather than something the simulation asserts.

## Features

- **A graph you configure.** Two combo boxes pick what goes on each axis from
  position, velocity, acceleration and time. Position against time, velocity
  against time, acceleration against time — or velocity against position, for a
  phase plot the sim never had to be told about. Switching an axis redraws the
  recording you already made; you never have to walk it twice.
- **One motion, three quantities.** Velocity and acceleration are trailing
  derivatives of the very position trace on screen, never separate measurements,
  so a turnaround shows up in all three at once.
- **A graph you can handle.** Drag it by its header, resize it from a corner,
  zoom with the wheel or the buttons, pan, or rescale it to fit the data.
- **Two screens, one activity.** Drag a figure with mouse, touch or keyboard;
  then do the same thing with a real **PASCO Wireless Motion Sensor (PS-3219)**
  over Web Bluetooth or a USB cable — no driver, no app, no install.
- **A table of the numbers, and a CSV of them.** *Show table* puts two chosen
  quantities side by side, one row per sample, following the newest row as a
  recording grows — and *Download CSV* writes exactly those two columns to a
  file for a lab write-up.
- **One clock, whatever the frame rate.** Samples are taken on the model's own
  fixed clock — 5, 10, 20 or 50 Hz, your choice — so the same walk gives the
  same graph on a 60 Hz laptop and a 144 Hz display.
- **The sensor settings PASCO's own software offers.** Change sign, zero at the
  start of a run, zero now, remove the zero offset, and long or short range.
- **Fully keyboard operable**, with a live screen-reader summary of the
  recording and spoken announcements when an axis changes.
- Installable and offline-capable (PWA), with a projector-friendly colour
  profile and English, French and Spanish.

## Quick Start

```bash
npm install
npm run icons     # generate PWA icons on a fresh clone
npm start         # → http://localhost:5173
```

To use a real sensor, open the **Motion Sensor** screen in **Chrome, Edge or
Opera** over HTTPS (or `localhost`), switch the PS-3219 on (or plug it in), and
press *Connect by Bluetooth* or *Connect by USB*. Stand the sensor at waist height with three or four metres of clear
floor in front of it. Firefox and Safari have neither Web Bluetooth nor WebUSB;
the screen says so instead of offering a button that cannot work.

Add `?showDiagnostics=true` to see the device's measurement list and its raw
readings — useful when bringing hardware up.

**Sensor options** on that screen adjust what the readings *mean*: reverse the
sign, zero the sensor where the student is standing (now, or at the start of
each run), and pick the range. Range is applied on the host as an acceptance
window — long accepts echoes out to the PS-3219's full 4 m, short only to 2 m,
which is what PASCO recommends for carts and tracks — because the device's own
configuration opcodes are not part of the wire protocol this sim speaks.

## Scripts

| Command | Description |
|---|---|
| `npm start` / `npm run dev` | Start Vite dev server |
| `npm run build` | Type-check + production build → `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run Vitest unit tests (includes memory-leak suite) |
| `npm run test:fuzz` | Optional Playwright fuzz smoke: pointer (`?fuzz`) + keyboard (`?fuzzBoard`), with `?ea`, 30s each |
| `npm run test:fuzz -- 90` | Same fuzz for 90 seconds (`--duration 90` or `FUZZ_DURATION=90` also work) |
| `npm run test:fuzz:quick` | Shorter fuzz smoke (10s) |
| `npm run test:fuzz:long` | Longer fuzz smoke (300s) |
| `npm run check` | TypeScript type check |
| `npm run lint` | Biome lint check |
| `npm run format` | Auto-format all files |
| `npm run fix` | Lint + auto-fix |
| `npm run icons` | Regenerate PNG icons from `public/icons/icon.svg` |
| `npm run release` | `check && lint && build && test`, then version patch + push tags |
| `npm run clean` | Remove `dist/` |

## Tech Stack

| Tool | Version | Notes |
|---|---|---|
| SceneryStack | ^3.0.0 | Simulation framework; `bamboo` for the graph |
| Web Bluetooth / WebUSB | browser APIs | Direct, dependency-free PS-3219 communication |
| Vite | ^8 | Build tool and dev server |
| TypeScript | ^7 | `erasableSyntaxOnly` — no `enum`, no `namespace` |
| Biome | ^2.5 | Lint + format |
| Vitest | ^5 | Unit tests (`happy-dom`) |
| Playwright | ^1.63 | Fuzz smoke test |
| vite-plugin-pwa | ^1 | Installable / offline |

Hardware: **PASCO Wireless Motion Sensor PS-3219** (0.15–4 m, 1 mm resolution,
Bluetooth 5.2 or USB). Web Bluetooth and WebUSB require a Chromium-based
browser and a secure origin.

## License

GNU Affero General Public License v3.0 or later — see the
[org LICENSE](https://github.com/OpenLyceum/.github/blob/main/LICENSE).

## Contributing

See the [org contributing guide](https://github.com/OpenLyceum/.github/blob/main/CONTRIBUTING.md).
