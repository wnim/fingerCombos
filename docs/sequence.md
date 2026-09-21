# The sequence

The routine is fixed ("holy") — hence a `const` in the code. Only the set
*contents* vary.

## Structure

The full routine is **one half, then the same half with the sets swapped**
(`B1↔B2`, `S1↔S2`). So the second half opens `B2 S2` instead of `B1 S1`.

The half, as written:

```
b1s1-b1-s1&s2b2-s2b1-b2b2-b1s2-b2-s2&s1b1-s1-b1
```

Parsed into steps (16):

```
 1  B1        bend B1
 2  S1        split S1
 3  -B1       unbend B1
 4  -S1 & S2  unsplit S1 & split S2   (simultaneous)
 5  B2        bend B2
 6  -S2       unsplit S2
 7  B1        bend B1
 8  -B2       unbend B2
 9  B2        bend B2
10  -B1       unbend B1
11  S2        split S2
12  -B2       unbend B2
13  -S2 & S1  unsplit S2 & split S1   (simultaneous)
14  B1        bend B1
15  -S1       unsplit S1
16  -B1       unbend B1
```

## Counts

- Half: 16 steps (2 are `&` pairs) = 18 individual actions.
- Full: **32 steps / 36 actions**.

## Properties

- The full 32-step routine **returns to neutral** at the end (nothing bent, no
  slot split), so playback loops seamlessly.
- It is **legal** throughout — see the validator in `docs/architecture.md`.

> History: step 5 was originally written `-b2` (unbend B2) — illegal, since B2
> was never bent at that point. Corrected to `b2`. This bug is what motivated
> the legality validator.

## The sequence picker

The routine above is only one of five selectable in the UI (`SEQUENCES` in
`core.js`). All are judged against the same yardstick: of the 16 possible
ordered transitions between B1/B2/S1/S2 (12 cross-set + 4 same-set), how many
does consecutively stepping through the sequence actually exercise?

| sequence | actions | cross covered | self covered | simultaneous steps |
|---|---|---|---|---|
| Holy with simul | 36 | 10/12 | B1, B2 | 2 |
| Holy no simul | 36 | 12/12 | B1, B2 | 0 |
| Half holy simul | 18 | 10/12 | B1, B2 | 2 |
| Half holy no simul | 18 | 12/12 | B1, B2 | 0 |
| Complete | 16 | 12/12 | B1, B2, S1, S2 | 0 |
| Dense | 22 | 12/12 | B1, B2, S1, S2 | 16 |

**Holy no simul** unrolls the routine's two `&` steps (`-S1&S2`, `-S2&S1`)
into two ordinary sequential steps. That alone closes the one gap the holy
sequence's simultaneity was papering over — S1→S2 and S2→S1 were never a
real, sequential transition, only ever a merged pair — at no cost: it's the
exact same 36 actions, just not simultaneous.

**Complete** is a from-scratch 16-action sequence — not a variant of the
holy sequence at all — that hits all 16 possible transitions (12 cross-set +
4 same-set) exactly once each. The holy sequence's own 36 actions are mostly
redundant: B1/B2 alone get revisited far more than their share of the 16
transitions requires. Two designs were tried and abandoned on the way here:

1. A raw Eulerian circuit over the four sets, ignoring physical constraints:
   16 actions, full coverage, but it necessarily puts *every* bend set
   concurrently active with *every* split set at some point, whereas the
   holy sequence only ever pairs B1 with S1 and B2 with S2 (see
   `hasIllegalOverlap`/`coexistingPairs` in the tests). Widening that
   pairing is what "Split bends" legality actually costs — this collapsed
   the legal-combination count 17-20x (240→12 with no thumb, 2,882→168
   with it).
2. A trimmed circuit that fixed (1) but let S1 and S2 be simultaneously
   active, which the holy sequence never does. `hasSiblingSubset`'s S1/S2
   branch only checks for exact equality (see its comment in `core.js`)
   *because* it assumes that; breaking the assumption made "Nested sets"
   silently stop catching real dead steps — 2,640 of 4,620 test
   quadruples it called fine actually stalled.

Complete keeps both properties intact — B1 only ever coexists with S1, B2
only with S2, and S1/S2 are never simultaneously active — so it costs
**nothing** under either toggle: the same legal-combination count as the
holy sequence (240 / 2,882), and zero mismatches against
`hasSiblingSubset`'s motionless-step check.

## The state-hypercube view (why the original design shape is provably optimal)

There's a second, stricter lens the holy sequence was actually designed
under, independent of the transition-coverage table above: never revisit
the neutral (all-off) state until the very last step, and never repeat a
move — where a move is a *directed* (state, action) pair, so "unbend B1
with S1 split" and "unbend B1 with nothing split" count as different moves
even though the verb is the same.

Model that as a graph: one vertex per legal state (neutral, plus the 7
reachable non-neutral combinations — B1 only ever coexists with S1, B2
only with S2, S1/S2 never together), one directed edge per legal move.
Restricted to single-bit moves plus the one compound move that's actually
*forced* (S1↔S2 are 2 bits apart with no single-bit route, and the only
other routes — through neutral, or through both split at once — are
exactly what the two rules above rule out), that graph has precisely 14
interior edges plus the 2 neutral-touching edges (depart, return) — 16
total — and it's perfectly balanced: an Eulerian circuit exists using
*every one* of them. **HALF is that circuit.** It doesn't just satisfy the
two rules, it exhausts the entire space of moves available under them —
there is no 17th legal move to add. COMPLETE, found independently by a
from-scratch search rather than by hand, turns out to be *the same 16
edges*, just visited in a different order — there's only one such edge
set, so any Eulerian circuit through it is "the same sequence" in this
sense, however differently it reads step by step.

**Dense** asks what happens if you drop "forced" and allow *any* legal
state pair up to 2 bits apart as a move, not just S1↔S2. That graph has 28
interior edges (up from 14) and is still balanced — a straight Eulerian
circuit through it is 30 moves, still never revisiting neutral early and
never repeating a move.

That 30-move circuit, though, includes 3 detours that are real edges in
the graph but never lead anywhere new: a bend+unbend of one set with
nothing else changing (twice — once for B1, once for B2), and a 4-move
round trip through B1/B2/`B1,B2` that ends exactly back where it started.
Each one leaves the state identical to where it found it, so dropping all
three doesn't cost anything checkable — still legal, still zero repeated
edges, still never touches neutral before the end, still the same 240 /
2,882 legal combinations — and removes exactly the steps that read as
filler. What's left is **22 moves, 16 of them simultaneous (73%)** — a
*higher* proportion than the untrimmed 30 (53%), because the cut fell
entirely on single-bit moves and left every compound one standing.
Physically it's still free either way — the cost of Dense was always in
what it feels like to perform (mostly two-actions-at-once, versus the
original's 2-in-16), not in what sets you're allowed to choose.
