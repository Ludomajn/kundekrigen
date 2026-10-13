# Evidence: Story 001 — Make it more intense

> **Story**: `production/epics/kundekrigen/story-001-more-intense-feel.md`
> **Type**: Visual/Feel · **Captured**: 2026-10-13 · **Branch**: `ccgs-test` (uncommitted working tree on top of `f562669`)
> **Sign-off**: [ ] PENDING — author must review the images below and sign off before `/story-done`

## How it was captured

Headless Chrome 156 with GPU (ANGLE Metal, Apple M2 Pro), 1280×720, driven over the
DevTools protocol. Local match: two players, **Åbent land**, weather **Slud**, wind on.
"Før" is `git archive HEAD` served on port 8790; "efter" is the working tree on 8788.
Maps and wind are seeded per match, so før and efter show different maps and different wind.
`01` was captured earlier on the fort map at 1920×1080 with SwiftShader.

## Images

| File | Shows | Criterion |
|---|---|---|
| `01-vind-modvind-slud-efter.png` | Wind streaks in headwind (vind 7.5) over the sky behind the fort | wind visible |
| `02-vindstriber-under-skud-efter.jpg` | Streaks across the whole sky during a shot (vind 11.0) | wind visible, follows strength |
| `03a/03b-sigte-*.jpg` | Charging the toner cannon, før/efter | aim framing |
| `04a/04b-skud-flugt-*.jpg` | Same moment of flight, før/efter: efter is clearly wider | shot zoom-out |
| `05a/05b-nedslag-*.jpg` | Impact, før/efter: efter punches in tight on the blast | impact punch-in |
| `06-hoejt-skud-zoom-ud-efter.jpg` | Steep shot followed into the sky | shot zoom-out |
| `07a/07b-overblik-*.png` | H overview, før (no streaks) / efter (streaks) | wind visible |
| `08a/08b-forloeb-*-kontaktark.png` | 40 frames: aim → flight → impact → glide to next player | transitions |

## Observed

- **Wind streaks work.** Two defects were found and fixed during the run (`render/weather.js`):
  1. In headwind the streaks were invisible. The quad mirrors when the wind blows left and
     was back-face culled. Fixed with `side: DoubleSide`.
  2. At normal wind they were almost invisible. Full strength was set at |vindNu| 1.5,
     but the roll is at most ±0.9 before weather. Tuned to `VIND_FULD` 0.6, 900 streaks,
     a higher base visibility and thicker streaks.
- **Camera:** the shot in flight is wider in efter than in før, and the impact punches in
  harder. In the contact sheet, transitions show no jumps between frames.
- **Streaks sit behind the terrain** (z −20). In none of the images do they cover a
  customer, a projectile or the aim marker.

## Not verified

- **Kill framing** (zoom 0.78 on death/drowning): no kill was staged. It is covered only by
  the node camera tests.
- **Frame rate at 1920×1080:** headless Chrome does not tick `requestAnimationFrame` without
  capture, so it could not be measured. Needs a check in a real browser.
- **Sound:** a screenshot cannot show it, and nothing was listened to. New sound events:
  - `vindlyd`: wind bed plus a gust whoosh panned in the wind's direction, synthesized in `ui/lyd.js`.
  - `uvejr` → `k_torden_1.ogg` (from Explosions – Sound Effects / `Far_Explosion.wav`).
  - `stenskred` → `k_stenskred_1.ogg` (from Explosions – Sound Effects / `Big_Explosion_Rocks_Falling.wav`).
- **Feel** (timing, weight, intensity): needs a playtest by the author.
- **Sleet/rain precipitation** is barely visible in any image, før or efter. This is
  pre-existing (rain box, `docs/kamera.md` "Kendte grænser") and not part of this story.

## Sign-off

- [ ] Author reviewed images 01–08 and accepts the look
- [ ] Author played a match and accepts the feel and the new sounds
