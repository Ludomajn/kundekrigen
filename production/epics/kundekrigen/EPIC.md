# Epic: Kundekrigen

> **Tier**: minimal — synthesized from `design/game-brief.md` by `/create-stories` on 2026-10-13
> **Status**: Ready

**Goal**: A Worms-like turn-based artillery game where angry clinic customers fight each other
with the clinic's own IT. Target feel (author, 2026-10-13): *feels and is experienced like modern
Worms games.*

**Scope**: the brief's MVP list (turn machine, destructible terrain, 15-weapon arsenal, wind and
weather, hit zone, hotseat) is **already built**. This epic covers the brief's **Build order** —
the work still to do.

**Ordering**: as in the brief's Build order (order and sizing not confirmed — `INTENT UNKNOWN`).

## Stories

| # | Story | Type | Status | ADR |
|---|-------|------|--------|-----|
| 001 | Make it more intense: camera, wind/gust effects, sound | Visual/Feel | Ready | N/A (minimal) |
| 002 | New weapons and the reworked arsenal UI | Integration | Ready | N/A (minimal) |
| 003 | Level design and randomisation | Logic | Ready | N/A (minimal) |

## Notes

- Run: `python3 app.py` → http://localhost:8788 (`/?stille` for no sound). Existing node checks
  live in `test/` (not `tests/unit/`); tests are waived at `qa.level: minimal`, screenshots are not.
- Engine: none (own web stack). No engine specialist agents apply (see `CLAUDE.md`).
