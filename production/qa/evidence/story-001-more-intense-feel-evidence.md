# Evidence: Story 001 — Make it more intense

> **Story**: `production/epics/kundekrigen/story-001-more-intense-feel.md`
> **Type**: Visual/Feel · **Captured**: 2026-10-13 · **Branch**: `ccgs-test` (uncommitted working tree on top of `f562669`)
> **Sign-off**: [x] Approved by the author in chat on 2026-10-13 ("Story 001 er godkendt. Jeg har set dem nu")

## How it was captured

Headless Chrome 156 with GPU (ANGLE Metal, Apple M2 Pro), 1280×720, driven over the
DevTools protocol. Local match: two players, **Åbent land**, weather **Slud**, wind on.
"Før" is `f562669` (`git archive`) on port 8790; "efter" is the working tree on 8788 for 01–08 and `ae45f2d` (`git archive`) on 8789 for 09–10.
Maps and wind are seeded per match, so før and efter show different maps and different wind.
`01` was captured earlier on the fort map at 1920×1080 with SwiftShader.

## Images

| File | Shows | Criterion |
|---|---|---|
| `01-vind-modvind-slud-efter.png` | Wind streaks in headwind (vind 7.5) over the sky behind the fort | wind visible |
| `02-vindstriber-under-skud-efter.jpg` | Streaks across the whole sky during a shot (vind 11.0) | wind visible, follows strength |
| `03a/03b-sigte-*.jpg` | Charging the toner cannon, før/efter | aim framing |
| `04a/04b-skud-flugt-*.jpg` | A shot in flight, før/efter. **Not comparable**: different maps, wind (2.0 vs 10.5) and frame timing | shot in flight (not a zoom comparison) |
| `05a/05b-nedslag-*.jpg` | An impact with the BANG, før/efter. **Not comparable**: different maps and moments | impact (not a punch-in comparison) |
| `06-hoejt-skud-zoom-ud-efter.jpg` | Steep shot followed into the sky | shot zoom-out |
| `07a/07b-overblik-*.png` | H overview, før (no streaks) / efter (streaks) | wind visible |
| `08a/08b-forloeb-*-kontaktark.png` | 40 frames: aim → flight → impact → glide to next player | transitions |
| `09a/09b-samme-seed-flugt-*.jpg` | **Same seed (4242)**, same map, wind and shot, same flight moment. Efter is ~18 % wider (props and stones ~18 % smaller) | shot zoom-out |
| `10a/10b-samme-seed-nedslag-*.jpg` | **Same seed (7)**, same impact spot. Zoom at the captured moment is about the same; efter shows the wind streaks (vind 14.5), før shows none | impact, wind visible |

## Observed

- **Wind streaks work.** Two defects were found and fixed during the run (`render/weather.js`):
  1. In headwind the streaks were invisible. The quad mirrors when the wind blows left and
     was back-face culled. Fixed with `side: DoubleSide`.
  2. At normal wind they were almost invisible. Full strength was set at |vindNu| 1.5,
     but the roll is at most ±0.9 before weather. Tuned to `VIND_FULD` 0.6, 900 streaks,
     a higher base visibility and thicker streaks.
- **Camera.** Images 03–08 come from different matches and cannot show a zoom change; an
  earlier claim based on them ("clearly wider", "punches harder") is **retracted**. The
  seeded pairs 09–10 (deterministic `Math.random` in the page, so both builds draw the same
  map, wind and weather) do compare: in flight efter is ~18 % wider (09). At impact (10) the
  difference is not visible in the captured frame — the new punch peaks at 2–6 % for
  ~0.16 s and the capture moment is not synchronised, so it neither confirms nor refutes it.
  The node tests (`test/kamera_*.mjs`, 50 pass) remain the measurement for aim, impact and kill.
- **Transitions:** at roughly 10 captured frames per second the contact sheets show no jump
  between frames. That is a weak check; the glide limits are asserted in the node tests.
- **Streaks sit behind the terrain** (z −20). In none of the images do they cover a
  customer, a projectile or the aim marker.

## Not verified

- **Kill framing** (zoom 0.78 on death/drowning): no kill was staged. It is covered only by
  the node camera tests.
- **Fog and the other weathers:** streaks were captured in slud only (images 01, 02) and,
  without streaks, in the før build. Solskin, overskyet, regn, sne and tåge were not looked at.
- **Host, guest and local show the same wind:** not tested over the network. It follows from
  the streaks reading `vindNu()` from simulation state, but nobody ran two clients.
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

- [x] Approved — author reviewed the images and approved story 001 in chat on 2026-10-13
- [ ] Feel and sound by a played match — not stated in the approval; carried as a known gap
