# Path-scoped rules — token budget & maintenance policy

## Why this file is strict about size

Everything under `.claude/rules/` is loaded into **every Claude Code session's context**
alongside the root `CLAUDE.md` — automatically, every session, regardless of whether that
session touches the module a given rule file describes. It is not loaded lazily and it is not
loaded only "when relevant." As AgentOS grows past its original six bounded contexts, an
unmanaged `rules/` directory becomes a fixed cost paid on *every single message*, before any
actual work starts — eventually crowding out the real conversation and the actual code in
context.

Treat every line added here as a **permanent recurring cost**, not a one-time note. Rough math:
1 token ≈ 4 characters of English. Six files at 100 lines × ~60 chars/line ≈ 9,000 tokens, paid
up front on every turn. The budget below exists to keep that number flat as the project scales,
not to let it grow with it.

## Hard budget

- **Per-file cap: 120 lines.** If a module's rules exceed this, the fix is to move the
  rationale/detail into `docs/rfc-001-platform-foundation.md` (or a new numbered RFC) and leave
  only the irreducible, load-bearing constraint here with a one-line pointer. Never relax the
  cap — treat hitting it as a forcing function to cut, not a sign to extend.
- **One rule file per bounded context, six-file ceiling**: `identity.md`, `organization.md`,
  `workspace.md`, `access.md`, `audit.md`, `event-backbone.md` (CLAUDE.md §1). No per-feature,
  per-PR, or per-session rule files — those belong in commit messages and PR descriptions, which
  cost nothing in every future session's context.
- **As of now, zero rule files exist**, despite Phases 1–5 already shipping tenancy, access, and
  audit. That is correct under this policy, not a gap — see "When to add a file" below.

## What belongs here (and what doesn't)

Belongs — cheap to keep, expensive to rediscover:
- A constraint that contradicts the "obvious" implementation a future session would otherwise
  pick (a genuine gotcha).
- A decision whose *why* isn't derivable from the code or `git log` and would cause real damage
  if re-litigated (e.g. "don't use Drizzle `.references()` across modules — breaks Nx
  boundaries; use a hand-written migration instead").
- A cross-module integration contract the *other* module's future sessions need to know.

Does not belong — delete on sight, or move out:
- Anything already in root `CLAUDE.md` — link to the section (`CLAUDE.md §3.4`) instead of
  repeating it.
- Anything derivable by reading the code: column lists, function signatures, directory trees,
  current API routes.
- Build/phase history or "what we did this session" narration — that is `git log`'s job, and it
  costs zero tokens until someone asks for it.
- Code samples longer than one line — point to `file.ts:42` instead of pasting a block.
- Full design rationale, alternatives considered, sequence diagrams — that belongs in
  `docs/rfc-*.md`, which is read on demand, not loaded every session.

## When to add a file

Before creating a new rule file, confirm all three:
1. A future session working in this module would otherwise **rediscover this the hard way**
   (a bug, a failed migration, a re-litigated decision already settled).
2. It is **not** already covered by `CLAUDE.md` or recoverable by reading the module's code.
3. It will still be true after the module is "done" — not a transient in-progress note.

If any answer is no, put it in the PR description, a code comment at the exact non-obvious
line, or nowhere.

## File shape

```markdown
---
scope: scope:<nx-tag>
budget: 100   # target line count; hard cap is 120
last-reviewed: Phase <N>
---

# <Module> rules

One sentence: what this module is, with a link to its CLAUDE.md / RFC section.

## Gotchas
- <constraint> — <why, one line>

## Cross-module contracts
- <what another module's future session must know, nothing else>
```

## Maintenance cadence

- At the end of every phase gate (CLAUDE.md §6/§7), spend five minutes pruning every rule file
  touched that phase: delete anything superseded, merge duplicate gotchas, evict anything that
  has grown into a paragraph back to `docs/`.
- Reducing total token footprint is a valid PR on its own — it does not need a code change to
  justify it.