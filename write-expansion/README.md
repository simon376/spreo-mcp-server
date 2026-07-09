# Spreo MCP — Write Expansion

**Goal:** Add write capabilities to the currently read-only Spreo MCP server, so an
MCP host (Claude Code) can *create* content on Spreo boards — starting with the
concrete use case: **generating a board from a meeting/briefing outline** (sections +
sticky notes / text items).

This folder is the **briefing package** for a fresh Claude Code thread that will do
the actual implementation. Read the three docs in order:

1. **`CONTEXT.md`** — current state of the codebase, what exists, what to reuse.
2. **`API-RESEARCH.md`** — the biggest unknown: which Spreo API v2 endpoints write,
   and the real risk that boards mutate over a realtime channel, not plain REST.
   **This must be resolved before writing code.**
3. **`REQUIREMENTS.md`** — scope, the tools to add, acceptance criteria, guardrails.

## TL;DR for the implementer

- The server is ~450 lines of TypeScript (ESM, `zod/v4`, `@modelcontextprotocol/sdk`).
  Three source files: `src/api.ts`, `src/index.ts`, `src/snapshot.ts`.
- `src/api.ts` **already has an unused `post<T>()` helper** — write support was
  anticipated. Reuse it; don't reinvent the HTTP layer.
- **Do NOT start by writing tools.** Start with `API-RESEARCH.md` step 1 (discover the
  write endpoint). The read parser (`snapshot.ts`) reverse-engineers a flat
  `instances/states/childLinks` model; creating an item means producing *valid entries*
  in that same model — that mapping is the hard part, not the MCP plumbing.
- Work on a branch. Do not push to `main` (`gitlab` remote) without the user's OK.
- The `instructions` string in `src/index.ts` currently advertises "read-only ... it
  cannot create, modify, or delete anything" — that claim must be updated in lockstep
  with any write tool, or the host will mislead users.

## Why this exists

Requested during DAI-673/DAI-744 guardrails work: the user wanted to produce a Spreo
board as meeting material and hit the fact that this MCP is read-only. Making it
writeable is being handled as its own piece of work in a separate thread — hence this
self-contained briefing.
