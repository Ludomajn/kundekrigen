# Story 002: New weapons and the reworked arsenal UI

> **Epic**: Kundekrigen
> **Status**: Ready
> **Layer**: N/A (minimal — no architecture layers)
> **Type**: Integration
> **Estimate**: TBD (sizing not confirmed — `INTENT UNKNOWN`)
> **Manifest Version**: N/A (minimal — no control manifest)
> **Last Updated**: [set by /dev-story when implementation begins]

## Context

**GDD**: `design/game-brief.md`
**Requirement**: Brief Build order 2 — "New weapons and tools, including the former stretch weapons (tail propeller, banana bomb, homing branch, napalm), plus rework of the arsenal UI: both the weapon bar and the 'Flere våben' drawer."

**ADR Governing Implementation**: N/A (minimal — no ADRs)
**ADR Decision Summary**: N/A (minimal — no ADRs)
**ADR Version**: N/A (minimal — no ADRs)

**Engine**: none (own web stack: vanilla ES modules + Three.js r186) | **Risk**: NOT ASSESSED (no VERSION.md risk rating) — treated as HIGH for the specialist-spawn decision; no engine specialist exists for this stack
**Engine Notes**: none (no ADR engine-compatibility analysis at minimal)

**Control Manifest Rules (this layer)**: N/A (minimal — no control manifest)

---

## Acceptance Criteria

*From `design/game-brief.md` (Core loop + Build order 2), scoped to this story:*

- [ ] Four new weapons exist in `static/js/sim/weapons.js` (data-driven): tail propeller, banana bomb, homing branch, napalm. Their names are reworked to fit the office/IT theme (the originals are first-theme names). **Names and effects are author-approved — `INTENT UNKNOWN`.**
- [ ] Each new weapon is deterministic: same seed and inputs give the same result for host, guest and replay (all randomness from `rngSim`; the simulation stays headless).
- [ ] Each interacts correctly with wind and weather (`vindFaktor`), destructible terrain, the customer hit zone, and water.
- [ ] Each has an ammo rule (start ammo, or crate-only), and the README weapons table is updated.
- [ ] Each has an icon, a hand model and projectile art in the flat Kenney-style language, and a sound.
- [ ] The weapon bar (10 slots, keys `1`–`0`) and the "Flere våben" drawer (`Tab`) are reworked and the game stays fully playable from the keyboard.
- [ ] Locked weapons still read "Fås i forsyningskasser"; the drawer stays grouped by category and shows the new weapons.
- [ ] Saved profiles still load (older bar layouts are migrated, `PROFIL_V`) and the chosen bar layout still persists.
- [ ] The arsenal UI rework is approved by the author via before/after screenshots. **What is wrong with the current UI is not stated — `INTENT UNKNOWN`.**
- [ ] The 15 existing weapons behave exactly as before.

---

## Implementation Notes

- Weapon data: `static/js/sim/weapons.js`; behaviour in `sim/behaviours.js` and `sim/physics.js`; UI in `ui/weaponpanel.js`; icons via `ikonURL`; hand models in `render/figur_view.js` (`MODEL`) and `render/kunst.js` (`HAANDVAABEN`).
- Napalm likely touches the fire system (`docs/farer.md`, Ild) — check it before adding a second one.
- Network: weapon ids are part of the protocol and saved profiles; do not rename existing ids (README).
- Crate weighting and which weapons are crate-only are not decided — `INTENT UNKNOWN`.

---

## Out of Scope

*Handled by neighbouring stories — do not implement here:*

- Story 001: camera, wind effects, general sound pass.
- Story 003: map generation.

---

## QA Test Cases

*N/A — no qa-lead specs at this tier; implement against the Acceptance Criteria above*

---

## Test Evidence

*Governed by `qa.level`: at `qa.level: minimal` tests are **waived** (advisory), but a story that changes something player-observable keeps its retained screenshot.*

**Story Type**: Integration
**Required evidence**:
- Retained screenshots in `production/qa/evidence/story-002-new-weapons-arsenal-ui/` (bar, drawer, each new weapon in hand and in flight) + notes in `production/qa/evidence/story-002-new-weapons-arsenal-ui-evidence.md`
- Launch: `python3 app.py`, open http://localhost:8788
- Existing optional checks: the headless sim runs in Node (`test/samspil.mjs`, `test/fysik_granat.mjs`); tests are waived at this `qa.level`.

**Status**: [ ] Not yet created

---

## Dependencies

- Depends on: None (brief build order only)
- Unlocks: None
