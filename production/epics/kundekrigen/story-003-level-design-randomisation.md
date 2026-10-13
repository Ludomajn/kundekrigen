# Story 003: Level design and randomisation

> **Epic**: Kundekrigen
> **Status**: Complete
> **Layer**: N/A (minimal — no architecture layers)
> **Type**: Logic
> **Estimate**: TBD (sizing not confirmed — `INTENT UNKNOWN`)
> **Manifest Version**: N/A (minimal — no control manifest)
> **Last Updated**: 2026-10-13

## Context

**GDD**: `design/game-brief.md`
**Requirement**: Brief Build order 3 — "Level design and randomisation (map generator rules, see `docs/baner.md`)."

**ADR Governing Implementation**: N/A (minimal — no ADRs)
**ADR Decision Summary**: N/A (minimal — no ADRs)
**ADR Version**: N/A (minimal — no ADRs)

**Engine**: none (own web stack: vanilla ES modules + Three.js r186) | **Risk**: NOT ASSESSED (no VERSION.md risk rating) — treated as HIGH for the specialist-spawn decision; no engine specialist exists for this stack
**Engine Notes**: none (no ADR engine-compatibility analysis at minimal)

**Control Manifest Rules (this layer)**: N/A (minimal — no control manifest)

---

## Acceptance Criteria

*From `design/game-brief.md` (Build order 3) and `docs/baner.md`, scoped to this story:*

- [ ] Each of the four map types (Fort, Øer, Grotte, Åbent land) gains at least one new archetype or clearly wider variation within the schemas in `docs/baner.md`. **How many is not stated — `INTENT UNKNOWN`.** Author approves from generated samples.
- [ ] "Tilfældig" still draws one of the real types before the map is built, and a run of different seeds produces visibly different maps of each type.
- [ ] A map depends only on the seed (and, for the fort, the teams' setup): host, host mirror and guests build identical maps without sending them.
- [ ] Every generated map stays playable across many seeds: the existing validation (`terrain_gen.js`) and the spilbarhed checks pass.
- [ ] Fort rule kept: the land between the forts always lies outside jumping distance of both forts; forts and their equipment stay mirrored and equal.
- [ ] Map size stays 5120 × 1792 wu; the sea stays at 300 wu with the guaranteed channels.
- [ ] The lobby map-type vote still works and lists any new type.
- [ ] `docs/baner.md` is updated with the new rules and the README's Banerne text still matches.
- [ ] The simulation stays headless and deterministic: `grep -rn 'three\.js\|document\.\|window\.\|Math\.random' static/js/sim static/js/core` shows comments only.

---

## Implementation Notes

- Generator: `static/js/sim/baneregler.js` (schemas, common rules), `sim/terrain_gen.js` (fort, validation), `sim/bane_natur.js` (islands, cave, open land).
- Terrain is never sent as a bitmap; clients regenerate from the seed, so any generator change is a protocol-visible change — old seeds will produce different maps.
- Existing checks to extend or run: `test/kort_*.mjs`, `test/lav_billeder.mjs` (map images), `test/tjek_gennemgang_*.mjs`.
- Which type matters most, and what "level design" means beyond the generator rules (hand-made maps?), is not stated — `INTENT UNKNOWN`.

---

## Out of Scope

*Handled by neighbouring stories — do not implement here:*

- Story 001: camera, effects, sound.
- Story 002: weapons and arsenal UI.
- Collapse of detached terrain (brief: Out of scope).

---

## QA Test Cases

*N/A — no qa-lead specs at this tier; implement against the Acceptance Criteria above*

---

## Test Evidence

*Governed by `qa.level`: at `qa.level: minimal` tests are **waived** (advisory), but a story that changes something player-observable keeps its retained screenshot.*

**Story Type**: Logic
**Required evidence**:
- Retained screenshots of generated maps per type in `production/qa/evidence/story-003-level-design-randomisation/` + notes in `production/qa/evidence/story-003-level-design-randomisation-evidence.md`
- Launch: `python3 app.py`, open http://localhost:8788
- Optional: extend `test/kort_*.mjs` (tests are waived at this `qa.level`; they are the cheapest way to run many seeds).

**Status**: [x] Created — see Completion Notes

---

## Dependencies

- Depends on: None (brief build order only)
- Unlocks: None

---

## Completion Notes
**Completed**: 2026-10-13 — approved by the author in chat ("Story 3 er godkendt")
**Criteria**: one new archetype per map type (Fort: port, Åbent land: kløfter, Grotte: skakter, Øer: atol), drawn by a separate rng step so old seeds keep their maps; deterministic and validated by the extended `test/kort_*.mjs`. Within scope of the author's later requests: shorter fort gap (median 1167 → 1017 wu, hop rule kept) and forts with 3 floors and 3 customers per team (`KUNDER_PR_HOLD = 3` in `net/transport.js` and `rum.py`).
**Deviations**: the number of archetypes was chosen autonomously (one per type), then approved; golden trace `test/farer_fra_spor.json` re-recorded (only fort/41 changed).
**Test Evidence**: `production/qa/evidence/story-003-level-design-randomisation-evidence.md` + images
**Code Review**: Skipped (review mode solo)
**Open**: only two open roster figures, so extra customers repeat names (II/III); measured-variation tables in `docs/baner.md` are stale; network play with the new maps not tested.
