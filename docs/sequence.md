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
