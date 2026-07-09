# FINDINGS — Spreo API v2 Write Transport

**Date:** 2026-07-09
**Author:** implementation thread (API-RESEARCH Step 1)
**Status:** Step 1 COMPLETE. Transport confirmed. Escalation required before per-item write tools.

## TL;DR

**Board *content* (stickies, text, shapes) CANNOT be written over the Spreo REST API v2.**
Content lives in a transaction-log / CRDT-style model mutated over the realtime
collaboration channel, not via REST. The REST API exposes **board-level and
container-level** writes only.

This is exactly the escalation case in `API-RESEARCH.md` → "If REST can't write content".
Recommended path is a **hybrid of Option A + Option C** (see below): ship board/folder/
template/task creation over REST now; the "generate a board from an outline" use case is
best served by the **template route**, not per-item content writes.

## Evidence

### 1. The full documented v2 endpoint surface (from the authenticated developer docs)

Write endpoints (POST) that EXIST, grouped by what they touch:

- **Boards (board-level):** `boards.create` (source = `"BLANK"` | Template Id | Board Id),
  `boards.delete`, `boards.patch` (label etc.), `boards.move`, `boards.join`,
  `boards.setSharing`.
- **Templates:** `templates.create2` (from a **board** source), `templates.patch`,
  `templates.delete`, `templates.stars.*`.
- **Workspaces / folders:** `workspaces.create/update/delete`, `workspaces.members.remove`,
  `folders.create/update/delete`.
- **Tasks:** `tasks.create`, `tasks.patch`, `tasks.delete` (board-associated action items —
  NOT canvas content).
- **Admin / Me / Notifications:** account admin ops, profile prefs, notification state.

**There is NO write endpoint that touches board canvas content.** `pods.*` is
**read-only**: only `pods.snapshots`, `pods.transactions`, `pods.transactionStats` exist —
all GET.

### 2. Content is a realtime transaction log (CRDT/OT), not REST-writable

- `pods.snapshots` docs: returns "initial or **commuted** state" — i.e. the snapshot is a
  *materialized view* of an operation log, not a directly-writable document.
- `pods.transactions` returns the raw op log. Real sample:
  ```json
  { "version": 1, "userId": "USTJIAW0Q3RD",
    "writes": [ [22, "283/26", "315/1"], [11, "315/1"] ] }
  ```
  `writes` are opaque numeric opcodes + `id/counter` references, applied client-side and
  version-incremented per transaction. This is a collaborative-editing op stream. There is
  no documented endpoint to append to it and no schema for the opcodes.

### 3. Probes confirm the write routes simply do not exist

POST (and GET) with `{}` body, comparing 404 (no route) vs 400/500 (route exists, bad input):

| Endpoint (guessed content-write) | HTTP | Verdict |
|---|---|---|
| `pods.snapshots.update` | 404 | no route |
| `pods.patch` / `pods.update` | 404 | no route |
| `pods.transactions.create` / `.append` | 404 | no route |
| `pods.commit` | 404 | no route |
| `instances.create` / `instances.patch` | 404 | no route |
| `states.update` / `snapshots.update` | 404 | no route |
| **`boards.create`** (known real) | **500** | **route EXISTS** (empty body → error) |
| **`boards.patch`** (known real) | **500** | **route EXISTS** |
| **`tasks.create`** (known real) | **500** | **route EXISTS** |

404 vs 500 cleanly separates "no such route" from "route exists, rejected empty body," so
the content-write routes are genuinely absent — not just method/param mismatches.

### 4. `boards.create` end-to-end — VERIFIED LIVE (with user authorization)

Ran create → read-back → delete in the private workspace (`WO2MBI9DPAUZ`, "Private Boards
of Simon Stieber") with the user's explicit OK:

- `boards.create` `{source:"BLANK"|"<templateId>", label, workspaceId}` → 200, returns
  `{id, podId, label, ...}`.
- **Create-from-template populates content synchronously.** A board cloned from a template
  (`source: <templateId>`) returns a `pods.snapshots` payload that **immediately** contains
  the template's instances (verified: 25 instances — Zone/Text/TaskCard/Connector — with
  full `states`, `childLinks`, `parentLinks`). The existing `parseSnapshot` reads it fine.
- `boards.delete` `{boardId}` → 200; subsequent `boards.info` → 404 (gone).

> **Gotcha:** `pods.snapshots` must be called with **`podId` only** (as `getBoardSnapshot`
> already does). Adding `format=json` returns an EMPTY snapshot (0 instances). An earlier
> "content didn't populate" conclusion in testing was this param bug, not async hydration.

### 5. Templates are rich and searchable (the chosen use case)

`templates.list2` returns 200 templates (75 account/team-owned), **every one with a
`description`**, plus categorized `tags` (Retrospectives, Meetings & Workshops, Planning,
Sales, Product Management, Ice Breakers, …) and `complexity`/`people`/`time` metadata.
`templates.list2?filter=team` narrows to account templates. This fully supports a
"search me a fitting template for a customer meeting / case X" flow: filter client-side over
label + description + tags, then `boards.create` from the chosen template id.

## What this means for the requested tools

| Requested tool | Feasible over REST? | Notes |
|---|---|---|
| `create_board` | **YES** | `boards.create` with `source:"BLANK"`, or clone from a Board/Template Id. |
| `add_board_item` (one sticky/text) | **NO** | Requires realtime op protocol. Not in REST API. |
| `add_board_section` (header+container+children) | **NO** | Same — depends on per-item content writes. |
| `create_board_from_outline` (per-item) | **NO (as scoped)** | Cannot place arbitrary stickies via REST. |
| `create_board_from_outline` (**via template**) | **PARTIAL / YES** | `boards.create` with `source:"<TemplateId>"` clones a pre-authored template. Content still comes from a human-made template, not from arbitrary outline text. |

## Recommendation — escalate with these options

Ordered by honesty/value for the "generate meeting material" use case:

- **A. Board-level REST tools (ship now, low risk):** `create_board` (BLANK / from template /
  clone existing), plus optionally `create_folder`, `create_template_from_board`, and
  `create_tasks` (action items). Honest, useful, no false capability. Does **not** place
  stickies.
- **C. Template/clone route for "from outline":** best REST-only fit. Pre-author a set of
  section-layout templates in Spreo; `create_board_from_outline` picks a template and
  clones it via `boards.create`. Limitation: the *text* of stickies still can't be injected
  over REST — only structure/layout is reproducible. So this generates the *skeleton*, not
  the filled-in notes.
- **B. Realtime client (large, separate project):** reverse-engineer the `writes` opcode
  protocol + realtime channel to place arbitrary items. This is the ONLY path that fully
  satisfies "generate a filled board from an outline." Significant scope, no public spec,
  fragile against server changes. Recommend NOT doing this without a dedicated decision.

**Suggested next step:** implement **Option A** (`create_board` at minimum) behind a live
round-trip verification, update the read-only self-description, and defer B/C pending the
user's call on how important arbitrary-content placement is. Per-item content-write tools
(`add_board_item`, `add_board_section`) are **not implementable** against the current public
REST API and should be marked blocked, not half-built.

## DECISION (user, 2026-07-09): Option A + C via templates

Ship a template-driven flow, verified live:

1. `list_templates` — search templates by keyword over label + description + tags
   (optionally `filter=team` for account templates). Returns id/label/description/tags so an
   agent can pick "a fitting template for case X".
2. `create_board` — `boards.create` from `BLANK` or a template id, into a workspace/folder.
   Verifies by reading the board back and reports instance count.

Per-item content writes remain out of scope (REST can't do them). Playwright MCP was
considered for arbitrary-content placement (Option B) but is deferred — not needed for the
template route.
