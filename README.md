# Finger Fitness routine

A one-hand bend/split drill (inspired by Greg Irwin's *Finger Fitness*), and an
interactive visualizer for it.

There is **one** routine — a fixed "holy" sequence of moves. What changes is
which fingers and slots you assign to the four sets (B1, B2, S1, S2). The app
takes those set assignments, compiles the abstract sequence into an explicit
per-finger routine, and animates it on a programmable hand.

## Run it

It's still zero-dependency, zero-build static files — but the code is ES
modules now, and browsers won't load those over `file://`. So serve the folder:

```sh
npm run serve        # python3 -m http.server 8000
```

then open <http://localhost:8000>. Any static server will do.

```sh
npm test             # node --test — the model, no browser needed
```

`npm` is only used as a place to keep those two commands. There are no
dependencies and nothing to install.

## What it does today

- **Programmable hand** — a parametric line-art hand that can show any
  combination of bent fingers and open slots, and animates between states.
- **Sets input** — put fingers in B1/B2 (bends) and slots in S1/S2 (splits).
  Your selection is remembered across reloads.
- **Compiler** — folds the holy sequence over your sets into an explicit,
  readable sequence (`bend 1·2`, `unsplit 34 & split 12`, …). Overlapping sets
  are handled correctly: the hand state is derived from which sets are active,
  so unbending one set can't straighten a finger another set still holds.
- **Player** — steps/plays the compiled routine through the hand, with a tempo
  control. Click any row to jump.
- **Set map** — an optional overlay on the hand itself, color-coded per set
  (B1/B2/S1/S2, matching the chip colors), so someone who already knows the
  sequence can read the whole drill off the diagram without stepping through
  playback. A finger or slot in two sets lights up both halves of its marker.
  Toggleable; the toggle is remembered like everything else.
- **Validator** — rejects an illegal routine (bending a bent set, etc.) loudly.

## Files

| File | What's in it |
|------|--------------|
| `index.html` | Markup only — the SVG stage and the control panel. |
| `styles.css` | All styling. |
| `src/core.js` | The model: digits, slots, the split model, the sequence, the compiler. Pure — no DOM. |
| `src/hand.js` | The puppet: builds the SVG and animates it. |
| `src/app.js` | Controls, player, persistence, boot. |
| `test/core.test.mjs` | Tests for `core.js`, run by `npm test`. |
| `docs/notation.md` | Glossary + the action/notation grammar (fingers, slots, sets, sequence language). |
| `docs/sequence.md` | The holy sequence: the const string, its structure, and counts. |
| `docs/architecture.md` | How the code is organised and the key design decisions. |
| `docs/roadmap.md` | The four project goals and the open questions still to resolve. |

## Goals (short form)

1. A glossary precise enough to discuss the routine without ambiguity.
2. Enumerate all valid set selections.
3. Visualize the routine for any given set selection. *(this app)*
4. Practice and master all combinations (assuming fewer than ~100).

See `docs/roadmap.md` for status and open questions.
