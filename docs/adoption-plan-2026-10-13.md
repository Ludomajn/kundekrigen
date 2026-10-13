# Adoption Plan

> **Generated**: 2026-10-13
> **Project phase**: Not set (no `project.stage`; code-root heuristic NOT ASSESSED because `engine.name` is empty)
> **Engine**: Not configured
> **Workflow tier**: minimal (`modes.rigor` not yet set; minimal is the default)
> **Template version**: v1.1.3

Work through these steps in order. Check off each item as you complete it.
Re-run `/adopt` anytime to check remaining gaps.

## Audit coverage (what was and was not assessed)

- **NOT ASSESSED: code root.** `engine.name` is empty, so the code root could not be resolved.
  About 70 JS and Python files (`static/js/`, `app.py`, `ws.py`, `protokol.py`, `rum.py`)
  were not counted toward phase detection. Reading the artifact-only result ("Fresh") as
  "nothing exists" would be wrong: this is a working game.
- **NOT ASSESSED: design-doc format.** `docs/*.md` and `docs/udkast/*.md` (4,420 lines, Danish)
  sit outside `design/`. They were not format-audited because minimal expects
  `design/game-brief.md`, not GDDs. They are the source material for Step 2c.
- **Skipped at minimal (not gaps):** TR registry, control manifest and version stamp, sprint
  status, stage file, traceability matrix, GDD/ADR/UX audits.
- **Not applicable:** v1.0 migration. `project.yaml` exists, so there is nothing to convert.

Gap counts: BLOCKING 0 · HIGH 3 (2 closed as N/A on 2026-10-13, 1 open) · MEDIUM 2 · LOW 1

---

## Step 1: Fix Blocking Gaps

None found.

---

## Step 2: Fix High-Priority Gaps

### 2a. Configure the engine — N/A
Decided 2026-10-13: Kundekrigen is vanilla ES modules, Three.js and a Python-stdlib server,
not Godot, Unity or Unreal, and the template cannot configure that stack. `/setup-engine` is
skipped. Consequence: `engine.name` stays empty, so skills that resolve the code root from it
will not find the code. That is accepted, not fixed.
- [x] N/A

### 2b. Engine reference docs — N/A
Same decision as 2a. The dead `@docs/engine-reference/godot/VERSION.md` import in `CLAUDE.md`
was removed on 2026-10-13 and replaced with a one-line N/A note.
- [x] N/A (dangling import removed)

### 2c. Game brief
`design/game-brief.md` does not exist. At minimal it is the only design artifact, and
`/create-stories` needs it. The design already exists as notes in `docs/`: `baner.md`,
`farer.md`, `kamera.md`, `karaktervalg.md`, `filmintro.md`, `docs/udkast/*`.
Fix: `/reverse-document` to build the brief from the existing game and notes (preferred), or
`/brainstorm` to write it fresh.
**Time**: 30 min
- [x] `design/game-brief.md` written 2026-10-13 via `/reverse-document` (three `INTENT UNKNOWN` open questions remain in it)

---

## Step 3: Bootstrap Infrastructure

Not on the minimal path. The brief's build order is the plan. Next: `/create-stories` (or
`/dev-story` once stories exist).

---

## Step 4: Medium-Priority Gaps

### 4a. Naming conventions
`naming.*` is unset in `project.yaml`. `/setup-engine` normally sets it but is skipped (2a), so
fill it in by hand in `project.yaml` or leave it.
**Time**: 5 min
- [ ] naming conventions recorded

### 4b. Performance budgets
`performance.*` is unset in `project.yaml`. Same as 4a: fill in by hand or leave it.
**Time**: 5 min
- [ ] performance budgets recorded

---

## Step 5: Optional Improvements

### 5a. Forbidden Patterns and Allowed Libraries
Empty by design; they live only in `.claude/docs/technical-preferences.md`. Fill them in once
the project has opinions (for example, Three.js vendored in `static/vendor/`, standard-library
Python only on the server, no build step).
**Time**: 5 min
- [ ] Forbidden Patterns / Allowed Libraries recorded

---

## Not a gap, but unfinished

`/start` did not complete: `project.stage`, `modes.rigor` and `modes.automation` are unset
(the stage write was declined). Review mode currently resolves to `solo` from the minimal
default. Change depth with `modes.rigor`, or pin it with
`/settings --local modes.review_mode=<full|lean|solo>`.

---

## What to Expect from Existing Stories

No stories exist yet, so there is nothing to preserve. Once `/create-stories` has run,
existing stories continue to work with all template skills: format checks auto-pass when
fields are absent. Do not regenerate stories that are in progress or done.

---

## Re-run

Run `/adopt` again after Step 2 to verify the HIGH gaps are resolved. The new run will reflect
the current state of the project.
