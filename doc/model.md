# Model — Motion Sensor

What the sim computes, and why it computes it that way.

## The activity

A student records their own motion — by dragging a figure with the mouse, or by
walking in front of a PASCO Wireless Motion Sensor — and reads the result off a
graph whose two axes they choose.

Nothing is integrated and nothing is simulated: the student *is* the moving
object, and the sim's whole job is to measure position honestly and derive the
rest from it. The physics content is entirely in the reading of the graphs —
what a slope means, what a zero slope means, and how position, velocity and
acceleration of the same motion relate.

There is no target curve and no score. That is the deliberate difference from
the sibling [MotionMatch](https://github.com/OpenLyceum/MotionMatch): where
that sim asks "can you produce *this* graph?", this one asks "what does the
graph of what you just did look like — and what does it look like on other
axes?"

## What can go on an axis

Four quantities, either of which can go on either axis:

| Quantity | Unit | Where it comes from |
|---|---|---|
| Position | m | measured — the source, clamped to the 0–2 m track |
| Velocity | m/s | trailing derivative of the smoothed position trace |
| Acceleration | m/s² | trailing derivative of the velocity series |
| Time | s | `sampleIndex × sample period` |

Twelve ordered pairs, then, of which the interesting ones are position-time,
velocity-time and acceleration-time — and velocity against position, a phase
plot that falls out of the same four entries without the sim having to know what
a phase plot is.

Changing an axis redraws the recording on the new pair of axes. The points that
were on screen cannot simply be kept — they were sampled from different
quantities — so the graph rebuilds the series from the recorded values instead.
The same walk can therefore be read as x-t, then v-t, then v-x, without walking
it again.

## Sampling

A recording is sampled on a fixed-timestep accumulator, not on raw frame `dt`,
at a rate the student picks from **5, 10, 20 or 50 Hz** (20 Hz by default).
Three consequences that matter:

- The same walk produces the same graph whether it came from a 144 Hz display or
  from a sensor answering every 40 ms.
- Sample times are computed as `index × period`, never accumulated. Repeatedly
  adding 0.05 drifts — three seconds of it sums to 2.9999999999999996 — and a
  graph whose x values slowly slid off the grid would be quietly wrong.
- The graph's time axis is evenly spaced instead of bunching wherever the browser
  happened to be busy. The view therefore adds points from the model's
  `sampleEmitter`, not from the frame loop.

The rate is captured when Record is pressed and held for the whole run: changing
it mid-recording would put two spacings on one trace, and `index × period` would
stop agreeing with the samples already taken. The chooser is disabled while a
recording runs, so it never looks as though it did something it did not.

The ends of the list are set by physics rather than by taste. Below 5 Hz a walk
is too coarsely sampled for the derivative chain to mean anything; above 50 Hz
the sensor cannot answer every tick — one BLE round trip takes tens of
milliseconds — so the trace would repeat stale readings and report a stationary
student who was moving.

A `dt` above 0.25 s is treated as a backgrounded tab rather than a slow frame and
clamped, so returning to the tab does not paste in a long flat stretch the
student was never present for.

Recording ends when the student presses Stop, or at
`MAX_RECORD_DURATION_S = 60 s` — 3000 samples at the fastest rate, comfortably
inside the graph's 3200-point buffer, so it is the cap that ends a recording and
never the buffer silently dropping the beginning.

## The derivative chain

Position is smoothed with a **causal trailing mean**, then differentiated twice,
each time with a **trailing least-squares window spanning 0.2 s** — five samples
at 20 Hz, ten at 50 Hz, a floor of three at the slowest rate. The window is a
duration rather than a sample count precisely because the rate is a choice: the
same walk must read as the same speed at 5 Hz and at 50 Hz.

```
position ──trailing mean──▶ smoothed ──d/dt──▶ velocity ──d/dt──▶ acceleration
```

### Why trailing rather than centred

A centred window would let a sample recorded later change the shape of the curve
already drawn, so the plot would rewrite its own past as the student watched it.
The cost of a causal filter is a half-window of lag — about 0.1 s per stage —
which is the honest price of a graph that only ever grows to the right.

Near the start a trailing window cannot slide forward without ceasing to be
causal, and it is not allowed to shrink either: a slope fitted through two points
is wildly noisy, and the start is exactly where a student's first push-off is.
So each stage reports a value only once its whole window lies over *fully
formed* input from the stage before:

| Stage | First defined at sample | At 20 Hz (window 4) |
|---|---|---|
| smoothed position | `w − 1` | 0.15 s |
| velocity | `2(w − 1)` | 0.30 s |
| acceleration | `3(w − 1)` | 0.45 s |

Waiting for the smoothing to fill matters as much as waiting for the derivative:
a mean over fewer points lags a ramp by a varying amount, and a velocity taken
across those partial means reads half the true speed.

### Why velocity is not read from the device

The PS-3219 can report its own velocity. It is not used. The device differentiates
over a different window from ours, so the two screens would draw different
velocity curves for the same motion — and the whole point of the pairing is that
they do not. Reading one measurement per BLE round trip instead of three also
keeps the poll rate up.

### Acceleration is the roughest of the three

It is a second derivative of an already-noisy measurement: two stages of lag
(≈0.2 s) and noise amplified twice. On the sensor screen especially it will look
ragged next to position. That is a true statement about differentiating real
measurements, not a defect to be smoothed away — widening the window would buy
smoothness with lag, and hide the turnarounds the activity is about.

Velocity and acceleration read 0 until their windows have filled (the table
above), rather than reporting a slope from one or two points.

## Hardware

The **PASCO Wireless Motion Sensor (PS-3219)** measures 0.15–4 m by ultrasound
at up to 250 Hz, with 1 mm resolution. It reports a raw echo time in
microseconds; position is `echo / 10⁶ × 344 m/s ÷ 2`, computed host-side.

While recording, the sim requests the two-byte echo time every 40 ms — faster
than it samples at every rate up to 20 Hz, so a fresh reading is waiting when the
fixed clock takes one. At 50 Hz the link is the limit and some samples repeat the
previous reading. Polling stops when the recording does, so the transducer is
silent and the last position remains displayed. The connection stays open for
another recording. Clearing a run does not start it again — only Record does.

Because the sensor is silent between runs, its last value is wherever the student
stood when the previous recording ended. The clock therefore does not start at
the press of Record but at the **first reading of the new run**: that reading is
t = 0, and with *zero at start* on it is also the reading the zero is taken from,
so t = 0 is exactly 0 m. On the Simulation screen the walker is always current
and t = 0 is taken at the press itself.

If the sensor disconnects or stops answering mid-recording, the recording ends
there. What was recorded stands; sampling the last reading for the rest of the
minute would draw a student standing still who was never there. A poll that
fails says so; a stream cannot, because there is no round trip left to fail, so
a stream that has delivered samples and then falls silent for a second (or five
sample periods, if longer) is treated as lost. A stream silent from the start
is answered by polling instead.

### From echo time to published position

Everything a student can change about a reading is applied host-side, in one
place and in this order:

```
echo time ─▶ distance ─▶ range gate ─▶ − zero offset ─▶ × sign ─▶ published
```

- **Range** decides which echoes to believe: **Long** accepts 0.15–4 m, the
  device's full reach; **Short** accepts 0.15–2 m, which is what PASCO
  recommends for carts and tracks, where a far echo is far more likely to be a
  wall than the target. A reading outside the window is *dropped*, not clamped —
  holding the previous position is less of a lie than pinning the walker to the
  end of the track. A reading of exactly 0 means no echo returned at all, and is
  dropped by the same rule.

  On the device this setting is a gain ramp, and PASCO's own software sets it
  over the link. It is a host-side filter here because PASCO's configuration
  opcodes are not part of the wire protocol this sim speaks, and guessing a
  command to write to real hardware is not a thing to do on a hunch.

- **Zero offset** subtracts a captured distance, so displacement can be measured
  from wherever the student is standing. *Zero Sensor Now* takes a fresh one-shot
  reading; *zero at start* captures the first accepted reading of each run — a
  reading the device has just sent, never the last one republished after an
  adjustment, which is where the previous run ended.

- **Change sign** negates what is left. Zeroing happens first, so an offset taken
  at 1.2 m still puts zero where the student stood once the axis is reversed.

Change sign, Zero Sensor Now and Remove Offset are locked while recording. Each
shifts every reading after it at once, which mid-run would put a step in the
trace and a spike in velocity and acceleration that no one walked. Range and
*zero at start* stay free: one filters echoes, the other only arms the next run.

The track drawn on screen is **0–2 m**, a practical classroom walking distance,
and the walker is clamped to it for drawing only: a sign-flipped or zeroed
reading is a real measurement that belongs on the graph and in the table even
when it has nowhere to stand on the track.
