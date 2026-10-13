# Evidence: Story 002 — New weapons and the reworked arsenal UI

> **Story**: `production/epics/kundekrigen/story-002-new-weapons-arsenal-ui.md`
> **Type**: Integration · **Captured**: 2026-10-13 · working tree on `ccgs-test` (uncommitted)
> **Sign-off**: [x] Approved by the author in chat on 2026-10-13 ("Arsenalet er godkendt")

## How it was captured

Headless Chrome 156 (GPU), 1280×720, local match, Åbent land, Solskin, seeded `Math.random` (11).
The two crate-only weapons cannot be started from the UI without a crate, so they are shown
locked in the drawer and verified only in the headless test.

## Images

| File | Shows |
|---|---|
| `01-skuffe-moedeindkaldelsen.png` | Drawer, Skyts: Mødeindkaldelsen with calendar icon and text |
| `02-kort-frugtordningen-laast.png` | Kast: Frugtordningen, fruit-basket icon, 0, "Fås i forsyningskasser" |
| `03-kort-turbostolen.png` | Udstyr: Turbostolen, office-chair icon, ×1 |
| `04-kort-kaffeulykken-laast.png` | Special: Kaffeulykken, coffee-pot icon, 0, "Fås i forsyningskasser" |
| `05-moedeindkaldelsen-maal.jpg` | Target marker jumped to the enemy with `T`; HUD names the weapon |
| `06-moedeindkaldelsen-flugt.jpg` | The invite (calendar drawing) in flight, fired away from the target |
| `07-moedeindkaldelsen-nedslag.jpg` | Its impact (BANG) on the slope on the way back toward the target |
| `08-moedeindkaldelsen-forloeb.png` | Contact sheet: flight → turn back → impact → next turn |
| `09-turbostolen-flugt.jpg` | Customer riding the office chair with rocket and exhaust, hint banner |
| `10-turbostolen-forloeb.png` | Contact sheet: take-off → climb → steer left → descend → land, turn ends |
| `11-bjaelke-ikoner-navn-popper-op.png` | New icon bar: name "Datalæk-bomben" pops up over the selected circle, keys under the icons |
| `13-skuffe-lodret-top.png` | New drawer: compact vertical list, Tonerkanon highlighted with its description unfolded |
| `14-skuffe-lodret-beskrivelse-udfoldet.png` | After four ↓: Datalæk-bomben highlighted and unfolded, the rows above collapsed |
| `15-skuffe-gitter-hover.png` | Final drawer (author: "alle våben uden at scrolle", mouse, expand on hover): 6×4 grid of circles with ammo and bar key, all 21 visible without scrolling; hovering Integrations inferno unfolds the detail card beside the drawer |
| `12-bjaelke-cirkler-naerbillede.png` | Close-up: red (weapons), blue (Hjemmearbejde), purple (Systemnedbrud, Fjernsupport) circles, dark centre, dark stroke |

## Observed

- All four weapons are in the drawer under their categories with drawn icons; the two
  crate-only ones are locked. The default 10-slot bar is unchanged.
- **Fixed during the run:** "Mødeindkaldelsen" broke mid-word in the drawer card
  ("Mødeindkaldels / en"). `ui/tekst.js` `ORDLED` now gives all four names a soft hyphen at
  the last compound part (Møde-indkaldelsen, Frugt-ordningen, Kaffe-ulykken, Turbo-stolen).
- Mødeindkaldelsen: marker → target → fire works; the invite turned back toward the
  target and hit terrain on the way, so the enemy was not damaged in this run.
- Turbostolen: thrust, steering, landing and turn end all work; the chair is drawn.

## Arsenal UI — the bar, as specified by the author (2026-10-13)

The author specified the rework: an icon-based bar; the name pops up above the icon when
it is selected; the key under the icon; the icon inside a colourful circle with a dark
stroke and a radial gradient darkest in the middle; the weapon drawn light over the dark
centre with a faint yellow stroke; red for weapons, blue for shields and defensive things,
purple for utilities. Implemented in `ui/hud.js`, `ui/vaabenikoner.js` (`farveGruppe`, and a
tile-free icon variant with a faint yellow edge) and `static/app.css`.

- Colour groups: blue = Hjemmearbejde, Papirbunke, Byggeskum; purple = Fjernsupport,
  Systemnedbrud, Kabelbakke, Turbostolen and the meta choices; red = everything else.
- The name pops in, holds ~1.4 s and fades (verified: opacity 0 after, 1 on the next pick);
  it also shows on mouse hover. With reduced motion it stays visible without animating.
- The drawer ("Flere våben") was then rebuilt on the author's request ("alt for stor"): a
  280 px vertical list in the bar's style — circle with icon and ammo count on every
  weapon, name, bar key; only the highlighted row unfolds its description (images 13–14).
  Images 01–04 show the old 440 px card drawer.
- Interpretation: "cirkel gradient, hvor det eneste er mørkeste" was read as "the innermost
  is darkest". If another reading was meant, it is one CSS line (`.favcirkel` background).

## Defects / gaps noticed

- **Name tag over the turn timer:** a customer flying near the top of the screen
  (Turbostolen) gets its name tag drawn on top of the turn timer (image 09).
- **Kaffeulykken's text** said "Vælg mål og retning" although the drops fall straight down — fixed to "Vælg mål — kaffen falder lodret ned".
- **Turbostolen** has no fuel gauge in the HUD and reuses the drill's motor sound.

## Not verified

- Frugtordningen and Kaffeulykken in the browser (crate-only). Covered by
  `test/vaaben_nye.mjs` (5 bananas explode; fire appears near the target; determinism).
- Homing actually reaching an open target in the browser; covered by `test/vaaben_nye.mjs`
  (lands closer than the same unguided shot).
- Sounds (not listened to), network play, saved-profile migration in a real browser.

## Tests

`node --test test/vaaben_nye.mjs` 4/4 · `samspil`, `samspil_lyd`, `fysik_granat` 20/20 ·
`kamera_*` 50/50 · `farer_*`: failures come from the parallel story-003 map changes
(proven by reverting only the map files: 39/39 pass).

## Sign-off

- [x] Author approved the arsenal ("Arsenalet er godkendt", 2026-10-13)
- [x] Covered by the same approval: icon bar and grid drawer with hover card
