# Improvement Recommendations — SceneryStackTemplate

Inherited from `SceneryStackTemplate`, and still about the **template**, not
about this simulation — it is kept because most of the findings apply to every
fork, this one included. Non-test recommendations, grouped by impact; each item
references the concrete file(s) involved so an editor (human or agent) can act
without re-exploration.

## Correctness / hardening

### 1. `package.json` overrides lack rationale and are loosely pinned

`three: ^0.125.0` overrides SceneryStack's `^0.104.0`; `lodash: ^4.18.0` overrides
`~4.17.12`; `brace-expansion: ^5.0.8` is also forced. All three are deliberate
bumps, but:

- **No paper trail.** JSON forbids comments, so document the reason for each
  override in `AGENTS.md` → "Compliance carve-outs" (or a new
  `package-overrides.md` note). Today there's no indication *why* three is pinned
  to a 2021 release or lodash to 4.18.
- **Use tilde or exact pins for forced overrides.** `^4.18.0` allows minor drift
  inside what's supposed to be a hard pin — prefer `~4.18.0` or `4.18.1`.
- **`three@0.125.2` has open CVEs** and is from Mar 2021. If SceneryStack ever
  drops its `three` dependency, this override silently lingers. Add `three`,
  `lodash`, and `brace-expansion` to dependabot's `ignore:` list
  (`.github/dependabot.yml`) so it stops opening PRs that fight the override.

### 2. `engines.node: ">=24"` allows local drift past Node 24

Baton's `check-node-version.sh` enforces Node 24 in CI, but a developer on
Node 25 passes `engines` and fails in CI anyway. Tighten to `">=24 <25"` and:

- Add a root `.nvmrc` containing `24`.
- Add a root `.npmrc` with `engine-strict=true`.

…so installs fail fast locally instead of in CI.

### 3. Reusable workflows pinned to `@main`

`.github/workflows/ci.yml` and `deploy.yml` reference
`OpenLyceum/Baton/.github/workflows/*@main`. Every sim using this template is
exposed to a compromised Baton commit. Pin to a SHA (or a `@v1` tag) for the
template — it's the one repo forks will copy. At minimum, document the trade-off
in `AGENTS.md`.

### 4. `rename-sim.ts` replacement table is order-fragile

`scripts/rename-sim.ts` `REPLACEMENTS` relies on "longest first" with overlapping
prefixes (`Sim` → `MotionSensorColors` → `MotionSensorConstants`). It works today only because the
bare token `Sim` is not in the list, but adding it (a common request) would
silently corrupt every `MotionSensorColors`/`MotionSensorConstants` occurrence. Either:

- Add a comment enforcing the invariant at the top of `REPLACEMENTS`, or
- Switch class-token replacements to `\b`-bounded regex matches.

## Security headers (`vite.config.ts`)

### 5. Missing `Referrer-Policy` and `Permissions-Policy`

Easy wins next to the existing COOP/COEP/CSP block in `securityHeaders`:

```ts
"Referrer-Policy": "strict-origin-when-cross-origin",
"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
```

### 6. CSP `unsafe-eval` / `unsafe-inline` are explained but not tracked

The inline comments say these are required by SceneryStack, but there's no
action item for revisiting them. Add a `TODO(scenery-#NNN)` reference (or link
to the upstream issue) so the cleanup is actionable rather than forgotten.

## DX / API surface

### 7. `StringManager` getter return types are inconsistent

`src/i18n/StringManager.ts`:

- `getTitleStringProperty()` is explicitly typed `ReadOnlyProperty<string>`.
- `getSimulationA11yStrings()` and `getPreferences()` return inferred JSON types.

Renaming a locale key today silently renames the public API exposed to views
with no compile error at the call site. Add explicit return types (or run the
JSON through a `satisfies` shape) so a key rename surfaces as a type error.

### 8. No dispose-pattern reference in `SimulationScreenView`

`src/simulation/view/SimulationScreenView.ts` is billed (in `AGENTS.md`) as the
"canonical accessibility reference," and its header comment instructs forks to
turn `currentDetailsContent` into a live `DerivedProperty` — with no example of
unlinking it. Ship a commented `public override dispose()` stub demonstrating
`DerivedProperty` / `Multilink` cleanup. Forks copy what they see.

### 9. `.npmrc` is absent

Fleet consistency would benefit from a root `.npmrc`:

- `engine-strict=true` (pairs with #2),
- `fund=false`,
- and a decision on `save-exact=` (pick one and propagate via Baton).

## PWA + build

### 10. `vite.config.ts` magic numbers

`assetsInlineLimit: 100_000_000` and `maximumFileSizeToCacheInBytes: 12 * 1024 * 1024`
are unexplained. Extract to named constants and explain *why* 12 MB (SceneryStack
bundle-size headroom):

```ts
const INLINE_LIMIT_BYTES = 100 * 1024 * 1024;
const WORKBOX_MAX_FILE_BYTES = 12 * 1024 * 1024; // SceneryStack bundles exceed the default 2 MB precache limit
```

### 11. PWA manifest is minimal

`vite.config.ts` manifest lacks `id`, `categories`, `screenshots`, and
`display_override`. For a template that others copy:

- add `id: "motion-sensor"`,
- add `categories: ["education", "science"]`,
- add a `screenshots` array (improves the install prompt on Android/desktop),
- add `display_override: ["window-controls-overlay", "standalone"]`.

Also reconsider `orientation: "landscape"` — it's opinionated and many sims are
portrait-friendly. Consider leaving it out of the template.

### 12. `release` script skips tests

`package.json` `release` = `check && lint && build && version patch && push`. For
a template that ships a sample test suite, this is fine, but add a docblock note
in the script table (`README.md` / `AGENTS.md`) saying "intentional — template
tests are samples; real sims should append `&& npm test`."

## Docs / polish

### 13. No CI badge in `README.md`

A template repo especially benefits from a green CI badge at the top of
`README.md` — forks will copy the convention.

### 14. `SimulationKeyboardHelpContent` ships only `BasicActionsKeyboardHelpSection`

`src/simulation/view/SimulationKeyboardHelpContent.ts` constructs
`TwoColumnKeyboardHelpContent([basic], [])`. Since this is the a11y reference,
pre-stub a second column (slider help or a hotkeys section) commented out, so
forks see the pattern instead of inventing it.

### 15. `index.html` is bare

No `<meta name="description">`, no Open Graph tags. Trivial addition for
share-preview quality when sims get posted to LMSes or social media.

---

## Suggested first batch

The highest-value, lowest-risk subset to apply first:

- **#2** — engines + `.nvmrc` + `.npmrc`
- **#5** — Referrer / Permissions headers
- **#7** — explicit `StringManager` return types
- **#10** — extract Vite magic numbers
