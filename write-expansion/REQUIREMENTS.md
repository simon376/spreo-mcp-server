# Requirements — Write Expansion

## Objective

Enable an MCP host to create content on Spreo boards via this server, so a full board
can be generated from a meeting/briefing outline (sections + notes). Read tools stay
untouched and keep working.

## Scope

### In scope (target tools, pending API-RESEARCH.md)
Implement as many as the API supports, lowest-risk first:

| Tool | Purpose | Depends on |
|------|---------|-----------|
| `create_board` | Create a new (optionally empty) board in a workspace/folder | board-level REST |
| `add_board_item` | Add one item (Sticky/Text) at x,y to a board | content write / snapshot write |
| `add_board_section` | Create a section: header Shape + container + child items | `add_board_item` + childLinks |
| `create_board_from_outline` | Generate a whole board from a structured outline | ideally snapshot/template upload (see API-RESEARCH C) |

`create_board_from_outline` is the **primary use case**. If a full-snapshot upload
endpoint exists, prefer implementing this directly over composing per-item writes.

### Out of scope (for this iteration)
- Editing/moving/deleting existing items (write-then-verify create is enough for v1).
- Realtime/websocket protocol implementation — only if API-RESEARCH forces it, and then
  it's a separate escalation, not silently in scope.
- Auth changes, multi-account, permissions management.

## Functional requirements

1. **Reuse `api.post<T>()`** in `src/api.ts` — do not add a second HTTP helper.
2. New API functions live in `src/api.ts` next to the read functions, same style
   (typed, exported, dotted endpoint names).
3. New tools registered in `src/index.ts` using the **exact existing handler pattern**
   (try/catch, `{ content: [{ type: "text", text }] }`, `isError: true` on failure).
4. Every write tool must **verify its own result**: after writing, read the board back
   (reuse `getBoardSnapshot` + `parseSnapshot`) and confirm the item is present; report
   success/failure truthfully in the tool output.
5. IDs, coordinates, and the snapshot `version` field handled correctly (see
   API-RESEARCH Step 3). Fetch current version before a mutating write; handle conflicts.
6. `create_board_from_outline` input: a structured outline (board title + ordered
   sections, each with a title and a list of note strings). Define a Zod schema for it.

## Non-functional requirements / guardrails

1. **Update the server's self-description.** The `instructions` string and the
   `name: "spreo-readonly"` in `src/index.ts` claim read-only. Change both so the host
   correctly advertises write capability. The CLAUDE.md and README.md "read-only"
   statements must also be updated in the same change.
2. **Safety of writes:**
   - Never mutate a board the tool didn't create or wasn't explicitly given by ID.
   - No delete tools in v1.
   - Prefer creating a fresh board over appending to an existing one when the use case
     is "generate material."
3. **Fail loudly, not silently.** A 200 that didn't render must be surfaced as an error
   (that's what requirement 4 catches).
4. **Branch, don't push to `main`.** Open a feature branch; leave pushing/PR to the user.
5. Keep the diff minimal and in the existing style — no framework changes, no new deps
   unless the realtime path is chosen (which requires user sign-off first).

## Acceptance criteria

- [ ] `API-RESEARCH.md` Step 1 completed; findings written to `FINDINGS.md` (transport
      confirmed: REST content-write / snapshot-upload / realtime-only).
- [ ] `npm run build` passes (tsc clean).
- [ ] At least `create_board` works end-to-end against the live API (verified by
      reading the board back), OR — if no board-level create — the realtime finding is
      documented and escalated.
- [ ] Primary use case demonstrated: a board generated from an outline is readable via
      the existing `get_board_content` tool and matches the input outline.
- [ ] Server `instructions`, `name`, `CLAUDE.md`, and `README.md` no longer claim
      read-only; they accurately describe the new write tools.
- [ ] Each new tool verifies and truthfully reports its result.
- [ ] Changes on a feature branch; not pushed to `main`.

## Suggested first prompt for the new thread

> Read `write-expansion/README.md`, `CONTEXT.md`, `API-RESEARCH.md`, and
> `REQUIREMENTS.md` in `/Users/simonstieber/code/spreo-mcp-server`. Then start with
> API-RESEARCH Step 1: determine how Spreo API v2 writes board content (REST endpoint,
> full-snapshot upload, or realtime-only) and write your findings to
> `write-expansion/FINDINGS.md`. Do not write tool code until the transport is confirmed.
> Work on a feature branch.
