# Notation & glossary

The point of this file: discuss the routine with **no ambiguity**.

## Fingers

Pen-spinning notation:

- `1` index, `2` middle, `3` ring, `4` pinky.
- `T` thumb — optional. Internally it may be `0` (sorts before `1`), but it's
  always **displayed** as `T`.
- A global `enable_thumb` flag, default **false**.

**Mandate:** no scattered `if (thumb)` branching. Fingers live in one ordered
array. When the thumb is enabled it's just prepended: `[1,2,3,4]` →
`[T,1,2,3,4]`. Everything downstream (slots, layout, the split model) derives
from that array, so the code should "just work" for any digit count — even a
hypothetical 17-finger hand.

## Slots (between-finger gaps)

- Slots are **adjacent gaps only**: `12`, `23`, `34`, plus `T1` when the thumb
  is enabled. No non-adjacent slots (`13`, `24`, `14`, …).
- Generative rule: a slot is each **consecutive pair** in the ordered finger
  array. `[T,1,2,3,4]` → `T1, 12, 23, 34`. (This is why `T` sits at the front:
  it's what makes `T1` exist and nothing like `4T` appear.)

## Moves

Irwin's glossary: **bends** and **splits**, plus their reverses **unbend** and
**unsplit**.

- A *bend* folds a finger at the PIP joint (proximal stays straight; the middle
  and distal phalanges curl down).
- A *split* opens a slot (spreads the two adjacent fingers apart).

## The four sets

A routine instance is defined by four sets:

- `B1`, `B2` — each a set of **fingers** to bend (one or more).
- `S1`, `S2` — each a set of **slots** to split (one or more).

The whole set is bent/split as a unit.

**Overlap is allowed and well-defined.** A finger may sit in both B1 and B2 (a
slot in both S1 and S2). A digit is bent whenever *any* active set contains it,
so `-B1` does not straighten a finger that B2 is still holding — the sets are
claims on a finger, not commands to it. Whether overlap makes a *good* drill is
a separate question, still open in `docs/roadmap.md`.

## Action notation (the sequence language)

An action token is the set name itself:

- `B1` means **bend B1**; `S1` means **split S1**. The `B`/`S` already implies
  the move type, so you never write the word "bend"/"split".
- A leading minus is the reverse: `-B1` = **unbend B1**, `-S1` = **unsplit S1**.
- **No delimiter** between actions — the letter+digit self-delimits.
  `B1S1-B1` = `B1`, `S1`, `-B1`. (This works *only* because every token has both
  a letter and a digit; drop either and the no-delimiter rule breaks.)
- Simultaneous actions are joined by `&`: `-S1&S2` = unsplit S1 **and** split S2
  at the same time.

Convention: every routine starts with a bend, then a split — so the first bend
defines `B1` and the first split defines `S1`.
