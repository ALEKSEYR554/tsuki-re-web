# Movie files for knife-port (NOT in the zip)

Movies are big, so they are excluded from the zip on purpose.
Put them in `knife-port/assets/movie/` — on Windows this is normally
a junction to `dist/assets/movie/`, so files already in `dist` need no
copying. Only the `_en` files below are missing from `dist` and must be
copied from the unpacked ROM (`romfs_en/movie/`) by hand.

## Gallery movies (3)

- `prologue.mp4` — Prologue, always available in the Movie gallery
- `op1_arc.mp4` — Opening (Arcueid), unlocks after watching it in-game (04_00_ARC04_4_1)
- `op2_ciel.mp4` — Opening (Ciel), unlocks after watching it in-game (05_01_CIEL05_2_2_2)

## Language variants (EN playthrough)

The player tries the `_en` file first and falls back to the base name
when it is missing, so a missing `_en` file never breaks playback —
it just plays the Japanese version. Copy these from `romfs_en/movie/`
to get English openings, prologue and phase titles:

- `op1_arc_en.mp4` — MISSING from dist, copy it
- `op2_ciel_en.mp4` — MISSING from dist, copy it
- `phasetitle_01_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_02_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_03_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_04_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_05_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_05_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_06_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_06_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_07_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_07_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_08_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_08_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_09_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_09_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_10_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_10_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_10_02_en.mp4` — MISSING from dist, copy it
- `phasetitle_11_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_11_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_12_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_12_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_13_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_13_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_14_00_en.mp4` — MISSING from dist, copy it
- `phasetitle_14_01_en.mp4` — MISSING from dist, copy it
- `phasetitle_15_01a_en.mp4` — MISSING from dist, copy it
- `phasetitle_15_01b_en.mp4` — MISSING from dist, copy it
- `prologue_en.mp4` — MISSING from dist, copy it

## Base files the game addresses (already in dist)

Everything the scripts play (title backgrounds, TM_CI, credits, ending
movies, phase titles, phaseout, prologue, openings):

- `TM_CI.mp4`
- `credit00.mp4`
- `credit01.mp4`
- `credit02.mp4`
- `credit03.mp4`
- `credit04.mp4`
- `credit05.mp4`
- `credit06.mp4`
- `ed01_arc.mp4`
- `ed02_ciel.mp4`
- `ed03_ciel.mp4`
- `op1_arc.mp4`
- `op2_ciel.mp4`
- `phaseout.mp4`
- `phasetitle_01_00.mp4`
- `phasetitle_02_00.mp4`
- `phasetitle_03_00.mp4`
- `phasetitle_04_00.mp4`
- `phasetitle_05_00.mp4`
- `phasetitle_05_01.mp4`
- `phasetitle_06_00.mp4`
- `phasetitle_06_01.mp4`
- `phasetitle_07_00.mp4`
- `phasetitle_07_01.mp4`
- `phasetitle_08_00.mp4`
- `phasetitle_08_01.mp4`
- `phasetitle_09_00.mp4`
- `phasetitle_09_01.mp4`
- `phasetitle_10_00.mp4`
- `phasetitle_10_01.mp4`
- `phasetitle_10_02.mp4`
- `phasetitle_11_00.mp4`
- `phasetitle_11_01.mp4`
- `phasetitle_12_00.mp4`
- `phasetitle_12_01.mp4`
- `phasetitle_13_00.mp4`
- `phasetitle_13_01.mp4`
- `phasetitle_14_00.mp4`
- `phasetitle_14_01.mp4`
- `phasetitle_15_01a.mp4`
- `phasetitle_15_01b.mp4`
- `prologue.mp4`
- `titlebg1.mp4`
- `titlebg2.mp4`
- `titlebg3.mp4`
- `titlebg4.mp4`
