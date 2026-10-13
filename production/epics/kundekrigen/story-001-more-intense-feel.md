# Story 001: Make it more intense: camera, wind/gust effects, sound

> **Epic**: Kundekrigen
> **Status**: Complete
> **Layer**: N/A (minimal — no architecture layers)
> **Type**: Visual/Feel
> **Estimate**: TBD (sizing not confirmed — `INTENT UNKNOWN`)
> **Manifest Version**: N/A (minimal — no control manifest)
> **Last Updated**: 2026-10-13

## Context

**GDD**: `design/game-brief.md`
**Requirement**: Brief Build order 1 — "Make it more intense: more dynamic camera zooming, more visible wind and gust effects, more sounds." Goal: feels like modern Worms games.

**ADR Governing Implementation**: N/A (minimal — no ADRs)
**ADR Decision Summary**: N/A (minimal — no ADRs)
**ADR Version**: N/A (minimal — no ADRs)

**Engine**: none (own web stack: vanilla ES modules + Three.js r186) | **Risk**: NOT ASSESSED (no VERSION.md risk rating) — treated as HIGH for the specialist-spawn decision; no engine specialist exists for this stack
**Engine Notes**: none (no ADR engine-compatibility analysis at minimal)

**Control Manifest Rules (this layer)**: N/A (minimal — no control manifest)

---

## Acceptance Criteria

*From `design/game-brief.md` (Player goal & fail state + Build order 1), scoped to this story:*

- [ ] Camera zoom reacts more to the action than today: aim, shot in flight, impact and a kill each get a visibly distinct zoom/framing (existing states: `docs/kamera.md`). Author signs off on before/after captures.
- [ ] Camera transitions stay smooth: no visible jumps between states; motion is interpolated per display frame.
- [ ] `prefers-reduced-motion` is still honoured: the new zoom and any new shake are reduced or off (`docs/kamera.md`).
- [ ] Wind and gusts are visible in the world, driven by the same effective wind the shot feels (`vindNu`), so what the player sees matches what the shot does. Strength follows weather.
- [ ] The wind effect reads in every weather (incl. fog) and never hides a customer, a projectile or the aim marker.
- [ ] More sounds: new sound events for wind/gusts and for existing actions that are silent today; the list is recorded in the evidence doc. Each goes through the `ui/lyd.js` rules (shared short-sound channel, `vigtig`/`forrang`, positional volume) and stays silent until the first user gesture.
- [ ] The simulation is untouched: `grep -rn 'three\.js\|document\.\|window\.\|Math\.random' static/js/sim static/js/core` shows comments only.
- [ ] Host, guest and local play show the same wind direction and strength (taken from simulation state, not local randomness).
- [ ] No visible frame drops at 1920×1080 on the dev machine. (No numeric budget is set — `INTENT UNKNOWN`.)

---

## Implementation Notes

- Presentation only: `static/js/render/camera.js`, `render/fx.js`, `render/weather.js`, `ui/lyd.js`, `ui/hud.js`.
- Presentation subscribes to simulation events; the simulation must not learn that sound or camera exist (README, Lyd).
- New sounds are built by the `vaerktoej/` pipeline into `static/lyd/`; Kenney.nl is CC0.
- Known camera limit to consider: rain box is fixed at 3000×2000 wu and does not scale with zoom (`docs/kamera.md`, Kendte grænser).
- Which parts of "intense" matter most (camera, effects, sound) is not ranked — `INTENT UNKNOWN`.

---

## Out of Scope

*Handled by neighbouring stories — do not implement here:*

- Story 002: new weapons and their sounds/effects, arsenal UI.
- Story 003: map generation.

---

## QA Test Cases

*N/A — no qa-lead specs at this tier; implement against the Acceptance Criteria above*

---

## Test Evidence

*Governed by `qa.level`: at `qa.level: minimal` tests are **waived** (advisory), but a Visual/Feel story's retained screenshot is not.*

**Story Type**: Visual/Feel
**Required evidence**:
- Retained screenshots in `production/qa/evidence/story-001-more-intense-feel/` (before/after for aim, shot, impact, kill, and a windy/gusty scene) + sign-off in `production/qa/evidence/story-001-more-intense-feel-evidence.md`
- Launch: `python3 app.py`, open http://localhost:8788 (`/?stille` mutes). Sound cannot be shown in a screenshot; list the new sound events in the evidence doc.
- Existing optional checks: `test/kamera_*.mjs`.

**Status**: [ ] Not yet created

---

## Dependencies

- Depends on: None (brief build order only)
- Unlocks: None

---

## Completion Notes
**Completed**: 2026-10-13 — approved by the author in chat ("Story 001 er godkendt. Jeg har set dem nu")
**Criteria**: 9 — confirmed: wind visible (images 01, 02, 07b, 10b), simulation untouched (no diff in sim/ and core/), shot zoom-out (seeded pair 09); covered by node tests only: aim, impact and kill framing, smooth transitions, reduced motion (`test/kamera_*.mjs`, 50 pass); not verified: other weathers incl. fog, host/guest wind over the network, frame rate at 1080p, sound by ear, feel by a played match.
**Deviations**: two wind-streak defects found during the run and fixed in `render/weather.js` (back-face culling in headwind; visibility far too low at normal wind). Files outside the story's listed ones: `main.js` (wiring), `ui/haendelser.js`, `vaerktoej/kontorlyde.py`, `README.md`, `docs/kamera.md`.
**Test Evidence**: Visual/Feel — `production/qa/evidence/story-001-more-intense-feel-evidence.md` + 17 images in `production/qa/evidence/story-001-more-intense-feel/`
**Code Review**: Skipped (review mode solo)
**Open**: no sound on turn-timer tick, projectile bounces, crate parachutes or rising water; "400 Sounds Pack" has no licence file (the existing `k_*` sounds come from it).
