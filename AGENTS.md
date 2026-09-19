# AGENTS.md — Unified AI Development Standard

## Scope

This file governs external AI coding assistants working in this repository:
ChatGPT, Codex, Claude, Gemini, Cursor, and similar tools.

This file is not a runtime agent brain. Do not confuse these instructions with
any app-specific internal agents, memories, or prompts.

## Primary Goal

Save tokens while making verified, repo-safe progress.

## Non-Negotiable Rules

1. Do not guess.
2. Do not rewrite full files unless explicitly asked.
3. Do not touch unrelated files.
4. Do not create duplicate systems when an existing system can be extended.
5. Do not add dependencies without approval.
6. Do not delete files unless explicitly approved.
7. Do not claim behavior exists unless verified in code, tests, docs, or
   user-provided evidence.
8. Prefer compact patches, diffs, and exact file references over long
   explanations.
9. Keep output token-concise.

## Token Budget Protocol

Before meaningful work:

1. Identify the exact task.
2. Identify the likely owned area.
3. Search or inspect only the relevant files.
4. Read the smallest useful code range.
5. Produce the smallest correct change.
6. Validate with the narrowest useful test.
7. Report only what changed, where, and how it was verified.

Avoid full repo summaries, repeated architecture recaps, and giant pasted files.

## Preferred Output Format

Use this format by default:

Summary:
- One to three bullets.

Files:
- `path/to/file.py` — what changed or should change.

Validation:
- Command run or command recommended.

Risks / Next:
- Only include if meaningful.

## Coding Rules

1. Match existing style.
2. Prefer surgical edits.
3. Preserve public APIs unless the task explicitly changes them.
4. Keep contracts stable.
5. Add or update tests when behavior changes.
6. Keep generated artifacts, build outputs, caches, and environment files out
   of edits.
7. Do not hardcode secrets, local-only paths, credentials, or machine-specific
   values.

## Debugging Rules

When debugging:

1. State the observed failure.
2. Inspect the smallest relevant path.
3. Name the most likely cause.
4. Make one fix at a time.
5. Validate narrowly first.

Avoid random trial-and-error edits.

## Documentation Rules

Docs are memory, not a dumping ground.

Project memory lives in `.cursor/docs/`:

- `INDEX.md` — map of all docs and modules. Keep it small; it is read every
  session.
- `STATE.md` — update when a unit of work completes.
- `MAP.md` — update when symbols or files move.
- `DECISIONS.md` — append when an architectural choice is made.
- `VERIFY.md` — update when an acceptance command changes.

Update docs only when behavior, architecture, commands, ownership, or decisions
change.

Prefer updating the existing source of truth instead of creating new docs. Do
not create docs outside `.cursor/docs/` without approval.

Do not paste huge implementation summaries into always-loaded files.

## Context Rules

Do not assume the whole repo is in context.

Use this order:

1. Current user request.
2. `.cursor/docs/INDEX.md` — always. It maps everything else.
3. The docs INDEX names as relevant to the current task.
4. `.cursor/docs/MAP.md` instead of re-reading source for orientation.
5. Targeted source files.
6. Tests.

Read only the docs the INDEX names for the current task. Do not read the whole
docs directory — that replaces one context tax with another.

Trust `MAP.md` over re-reading files. If `MAP.md` is wrong, fix it in the same
change.

If more context is needed, ask for or inspect the smallest missing piece.

## Standard Propagation Rules

The canonical standard lives in one folder outside any project. Repos receive
copies. Editing a copy is a silent bug: the change is overwritten on the next
sync and looks like the AI ignoring instructions.

1. Never edit `AGENTS.md` or `.cursor/rules/*.mdc` inside a project. Those are
   generated copies. Edit the canonical folder instead.
2. After editing the canonical `AGENTS.md` or any canonical rule, run:

       .\sync-standard.ps1 -All -WhatIf     # show what would change
       .\sync-standard.ps1 -All             # apply

   Report the summary line, not the full output.
3. The canonical folder must be a git repository. Commit before syncing. A bad
   edit reaching every repo at once is only recoverable if the source is
   versioned.
4. Sync copies and seeds; it never deletes. `-Force` overwrites project memory
   in `.cursor/docs` and requires explicit approval.
5. If a project needs a rule the standard does not have, add a project-scoped
   rule alongside the synced one. Do not fork the standard.

## Documentation Size Rules

Docs are a token-saving layer. They stop saving tokens when they grow.

Ceilings, checked whenever a doc is edited:

| File | Ceiling | On exceeding |
|---|---|---|
| `INDEX.md` | 60 lines | tighten; it loads every session |
| `MAP.md` | 120 lines | split by subsystem, INDEX names the parts |
| `STATE.md` | 60 lines | archive completed entries |
| `VERIFY.md` | 80 lines | drop checks superseded by newer ones |
| `DECISIONS.md` | no ceiling | read on demand only, never auto-loaded |

Archive rule: keep the 10 most recent entries in `STATE.md` Done. Move older
ones to `.cursor/docs/archive/STATE-<year>.md`. Archives are never read unless
explicitly asked for. Do not summarise archives back into `STATE.md`.

If a doc exceeds its ceiling, fixing it is part of the current change, not a
follow-up task.

## New Repository Rules

When creating a new repository, seed it from the canonical standard folder
rather than hand-copying files:

    .\sync-standard.ps1 -Target <new repo path>

This copies `AGENTS.md`, `.cursor/rules/`, and the `.cursor/docs/` templates,
and registers the repo so it receives future updates. Hand-copying leaves the
repo unregistered, and it silently stops receiving standard changes.

Then fill in `.cursor/docs/INDEX.md` and `MAP.md` for the new project. Generic
templates provide no token savings.

## Cursor / Implementation Prompt Rules

When generating a Cursor prompt:

1. Give the exact owned slice.
2. List files to inspect.
3. List files allowed to change.
4. List files not allowed to change.
5. Include acceptance tests.
6. Keep prompt compact.

## Destructive Action Rules

Never perform these without explicit approval:

1. Delete files.
2. Drop or reset databases.
3. Force push.
4. Rewrite git history.
5. Remove tests.
6. Disable validation, linting, type checks, or security checks.
7. Change production config.
8. Rotate or expose secrets.
9. Overwrite `.cursor/docs/` files that hold project memory.

## Final Response Rule

End with:

- Summary
- Files changed
- Validation
- Remaining risk or next step

Keep it short.
