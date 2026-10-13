# Evidence: Story 003 — Level design and randomisation

> **Story**: `production/epics/kundekrigen/story-003-level-design-randomisation.md`
> **Type**: Logic · **Captured**: 2026-10-13 · working tree on `ccgs-test` (uncommitted)
> **Sign-off**: [x] Approved by the author in chat on 2026-10-13 ("Story 3 er godkendt")

## In the game (headless Chrome, GPU, 1280×720, Solskin)

Each match was started with the map seed forced (main-thread `Math.random` locked to the seed
while Start was pressed) and the world reported the expected archetype:

| File | Type / archetype | Seed |
|---|---|---|
| `spil-port-overblik.png` | Fort / `spir/port` — spire forts, rock arch in the sea between them | 1355681290 |
| `spil-kloefter-overblik.png` | Åbent land / `kloefter` — plain cut by canyons, a plank bridge and a stone arch | 45924014 |
| `spil-skakter-overblik.png` | Grotte / `skakter` — shafts linked by tunnels on several levels | 45924014 |
| `spil-atol-overblik.png` | Øer / `atol` — high ends, lagoon with flat islets | 45924014 |
| `spil-alle-fire-overblik.png` | The four side by side (H overview, tutorial box still open) | — |

An earlier version of these images showed the film intro and then the pause menu instead of
the map (capture-script timing). They were replaced; all four were opened and checked.

## Shorter gap between the forts (author request, 2026-10-13)

`fort-gab-foer-efter.png` — same seed (1355681290, fort/port), before and after: the forts
stand closer and the arch is narrower. Only 5–30 % of the free space now spreads the forts,
and the island, hill, arch and reefs are narrower. Gap between two forts (2 teams of 1,
300 seeds): median 1167 → 1017 wu, max 2177 → 1870. The hop-safety minimum is unchanged
(nobody can jump across), and it is the large part of the gap when something stands in the
middle — going much shorter would mean relaxing that rule. `test/farer_fra_spor.json` was
re-recorded (only `fort/41` changed, as its own header prescribes for intended generator
changes); `kort_*`, `tjek_gennemgang_*`, `farer_*` and `vaaben_nye` all pass.

## Three floors, three units per team (author request, 2026-10-13)

`fort-3-etager-3-kunder.png` — each team now has 3 units by default (`KUNDER_PR_HOLD`,
JS + rum.py): a team with fewer players is filled up and its players own the extra units.
The fort already builds one floor per unit, so both forts have 3 floors with one unit on
each (world: `prHold: 3`, 3 floors; units at y 420/580/740 per team). Tests:
`rum_spil_igen.py`, `test_ws.py` 28/28, client tests 83/83. Note: only two roster figures
are open, so the extra units repeat them ("Dr. Jan II", "III" …).

## Generator contact sheets

`kort_fort_port.png`, `kort_oeer_atol.png`, `kort_hule_skakter.png`, `kort_aaben_kloefter.png` —
12 seeds each, forced to the new archetype (`node test/lav_billeder.mjs <type> 12 0 <arketype>`).

## Tests

- `node --no-warnings test/kort_alle.mjs`: 390 ok, 0 fejl. Every `kort_*` file passes when
  run on its own; under `node --test test/kort_*.mjs` the timing checks in `kort_tid` fail
  from parallel load only (also the case on HEAD).
- `node --test test/farer_*.mjs`: 93/93. The hazard tests pin the pre-story archetypes
  (`test/farer_hjaelp.mjs` removes `SKEMAER.*.nye`); no assertion changed.
- `node --test test/tjek_gennemgang_*.mjs`: 4/4.

## Not verified

- Lobby vote listing any *new type*: none was added — the new archetypes are inside the
  existing four types, so the vote is unchanged.
- Network play with the new maps (host and guest must run the same code version).
- Measured-variation tables in `docs/baner.md` still carry the old numbers.

## Sign-off

- [x] Author approved the four archetypes ("Story 3 er godkendt", 2026-10-13)
- [x] Covered by the same approval: shorter fort gap, 3 floors and 3 customers per team
