# Roadmap & open questions

## Goals

1. **Glossary** — precise, unambiguous language for the routine.
   → done: `docs/notation.md`.
2. **Enumerate all valid set selections** — figure out every legal way to fill
   B1, B2, S1, S2, and how many there are.
   → *open, but no longer blocked.* See below.
3. **Visualize the routine for a given selection.**
   → working: `index.html` + `src/`.
4. **Practice and master all combinations** (assuming < ~100).
   → not started. Set choices already persist (`fingerCombos.v1` in
   localStorage); mastery tracking would extend that.

## Open questions

- **Set-membership constraints (goal 2).** Still to decide — but now a *choice*,
  not a constraint the code imposes:
  - Must B1 and B2 be disjoint, or can a finger be in both? Overlap is
    supported and well-defined (see below), so this is a question about what
    makes a sensible drill, not about what the app can represent.
  - Same for S1 and S2 and their slots.
  - Are there constraints linking the bend sets and split sets (e.g. can a split
    slot touch a bent finger)? This one is physical, not notational — worth
    testing on an actual hand.
  - Does swapping B1↔B2 (or S1↔S2) produce a *different* instance or the same
    one? The routine's second half is the first half swapped, so the two
    selections give the same 32 steps rotated by 16 — which argues for counting
    them once. Affects the enumeration count.

- ~~**Finger-level conflicts from overlapping sets.**~~ **Resolved.** The hand
  state is derived as the union of the active sets rather than mutated, so
  "unbend B1" cannot straighten a finger B2 is still holding. Set-level
  validation is now the complete legality story. See `docs/architecture.md`.

- **Thumb split cross-contamination.** With the thumb enabled, the
  median-anchored split model can drag the thumb when an inner slot (e.g. `12`)
  is split, because the thumb is just another array element. Confirmed still
  true. Fine for now (thumb defaults off); revisit if thumb work becomes real.
  The fix, if wanted, is to exclude non-finger digits from the prefix sum — but
  that is the first `if (thumb)` in the codebase, so it needs a reason.

## Nice-to-haves

- Distinguish the neutral "ready" pose from a flat hand, if useful for drilling.
- Progress/mastery tracking for goal 4.
- Keyboard transport (space to play, arrows to step).
