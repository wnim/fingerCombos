# Architecture

Three layers, three files. `core.js` is the model and knows nothing about the
page; `hand.js` draws and animates a hand from a state; `app.js` wires the
controls and the player. The layers only meet through exports — `hand.js`
imports the model, `app.js` imports both, and nothing imports `app.js`.

```
index.html   markup only            styles.css   all styling
src/core.js  model        (pure — runs in Node)
src/hand.js  puppet       (imports core)
src/app.js   controls     (imports core + hand)
test/core.test.mjs        (npm test)
```

These are ES modules, so the page must be served over http, not opened as a
file. `npm run serve`. That is the one cost of the split, and what buys it is
`core.js`: the whole model is importable and testable without a browser, which
is what goals 2 and 4 in the roadmap are going to need.

## Guiding mandate

One ordered digit array is the single source of truth. Slots, layout, and the
split model all derive from it by looping — no special-casing for the thumb, no
hardcoded slot lists. Adding the thumb is a prepend; the same code would handle
N digits.

## core.js — the model

- **`DIGIT_TABLE`** — the only place anatomy is declared (per-digit kind, length,
  width). `len`/`w` are *proportions*, not pixels; the renderer scales them.
- **`digitOrder(enableThumb)`** → the active array, e.g. `['1','2','3','4']` or
  `['T','1','2','3','4']`.
- **`slotsOf(order)`** → consecutive pairs → slot ids.
- **`splayAngles(order, splits)`** — the split model. **Median-anchored**
  prefix-sum: the hand rotates as little as possible, so a split's opening is
  absorbed by the smaller side. Edge slots (`12`/`34`) swing only the outer
  finger; the centre slot (`23`) swings both halves apart. `SPLIT_ANGLE` is the
  per-slot opening. Generalises to any N. (A test asserts no other anchor moves
  the hand less.)
- **`ROUTINE_HALF`** — the holy const string.
- **`parseRoutine(str)`** → steps; each step is an array of `{set, undo}`
  actions (array length > 1 for `&` pairs). **`tokenOf(step)`** renders one back.
- **`swapHalf(steps)`** → the sets-swapped half. `ROUTINE` = half + swapped half.
- **`validateRoutine(steps)`** → set-level legality check. Tracks each set's
  bent/split state and flags any impossible toggle (bend a bent set, unsplit an
  unsplit set, …). Runs at load; on failure `app.js` shows a red banner naming
  the bad step and throws.
- **`sanitizeSets(raw, order)`** → coerces arbitrary set data into a valid
  `{B1,B2,S1,S2}` for that digit order, dropping members that don't exist. Used
  both for restoring from storage and for clamping when the thumb is turned off.
- **`compile(sets, order)`** — folds `ROUTINE` over the sets. Each output step
  carries the abstract `token`, a human `label` (`bend 1·2`), and the resulting
  hand `state`.

### Derived state, not mutated state

`compile` records **which of the four sets are active** at each step, then takes
the union of their members to get the hand state. It never adds and removes
members on a shared set.

This is what makes overlapping sets correct. With `B1 = {1,2}` and
`B2 = {2,3}`, the old mutate-a-set model produced this at steps 7–8:

```
 7  B1   -> bends {1,2,3}
 8  -B2  -> bends {1}        ← finger 2 straightened; B1 still wants it bent
```

Deriving the union gives `{1,2}` instead, because finger 2 is still in an active
set. Consequences worth knowing:

- **Set-level legality is now the whole story.** Finger-level conflicts can no
  longer arise, so `validateRoutine` doesn't need to grow a second mode.
- **Sets may overlap freely**, which unblocks the enumeration question in the
  roadmap — the rule can be chosen on pedagogical grounds rather than forced by
  the code.
- A set-level instruction can therefore be a no-op for some of its members.
  `compile` says so in the label (`unbend 2·3 (2 stays bent)`) rather than
  letting the text contradict what the hand visibly does.

## hand.js — the puppet

`createHand(svg, {onStateChange})` builds into that element and returns the API.
More than one hand can exist on a page; nothing is global.

- **Canvas geometry** (`KY`, `FX0/FX1`, thumb anchor) lives here — it describes
  the *drawing*, not what a hand is. Anatomy stays in `DIGIT_TABLE`.
- **`layout(order)`** → each digit's base point, rest angle and width. Fingers
  spread to fill the palm width; widths come from `DIGIT_TABLE` as proportions,
  scaled so the widest finger nearly fills its share of the band. So per-finger
  anatomy survives *and* the layout adapts to any digit count.
- **Two drawings per finger**:
  - **extended**: three phalanges (proximal, middle, distal) with PIP/DIP creases.
  - **bent**: a real PIP fold — proximal stays straight, middle+distal curl down
    over the front, **nail at the tip**.
  Bending crossfades extended↔bent; it is *not* a puppet fold.
- **Gap markers** are an annotation layer appended **last**, so the digits can't
  occlude the chevrons or the slot label.
- **Set map** is a second, independent annotation layer: a static, toggleable
  overlay of B1/B2/S1/S2 *membership* (not the live playback state). A bend
  set draws as a rounded box around its member fingers — grouped into
  maximal runs of *adjacent* order-positions first (`runsOf`), so a
  non-contiguous set like `{1,3}` draws two separate boxes rather than one
  box that wrongly swallows finger 2. B1 and B2 use different padding (B1
  taller/narrower, B2 shorter/wider) so two boxes sharing a finger read as
  two distinct outlines with non-colliding labels, not a blurred edge. A
  split set draws as a small colored chevron right at its slot — the same
  spot the live playback chevron occupies, just a distinct shape, since the
  two are rarely visible at once. Only B1's box and S1's chevron get a text
  caption ("start here" / "then here"): the holy sequence always opens by
  bending B1 then splitting S1 regardless of what's in the sets (see
  `docs/sequence.md`), so that pair alone can orient someone without
  narrating the rest of the memorized routine; B2/S2 stay color-only.
  Driven by `setMap(sets)` (repaint membership) and `showMap(on)`
  (toggle visibility via a `.showmap` class on the root `<svg>`) — both
  independent of `setState`/`apply`. Boxes are rebuilt on every `setMap`
  call (their geometry depends on current membership); chevrons are
  pre-built per slot and just toggled. Both repaint from the last-given
  sets at the end of every `build()`, so a thumb-triggered rebuild (which
  tears down and recreates the whole SVG) doesn't blank the map.
- **Animation loop** — per-digit `theta` (rotation, from splits) and `bend`
  (0→1 crossfade) lerp toward targets each frame. Rotation is the puppet motion;
  bend is a picture swap.
- **API**: `setState({thumb, bends, splits})`, `bend(id, on)`, `split(id, on)`,
  `enableThumb(on)`, `reset()`, `setMap(sets)`, `showMap(on)`, and getters
  `state` / `order` / `slots`.

## app.js — controls, player, persistence

- **`SETS`** — `{B1, B2, S1, S2}`, the variable input, seeded from storage.
- **Chips** — one per legal member, rebuilt when the digit count changes.
- **Player** — walks the compiled states through the hand via `hand.setState`.
  Transport (reset/prev/play-pause/next) + tempo slider; click a row to jump.
  The tempo slider reads as *speed*, so the delay is `SPAN - value`, derived
  from the DOM at boot so the two can't drift apart.
- **Persistence** — sets, thumb, hand, loop, set-map visibility, and tempo go
  to `localStorage` under `fingerCombos.v1`. Every access is guarded: storage
  can be missing or throw, and a failure just means "start from defaults".
  Restored data goes through `sanitizeSets`, so a stale or hand-edited blob
  can't produce an invalid state.
- **Console access** — `window.hand` and `window.routine` are still exported for
  poking at from devtools.
