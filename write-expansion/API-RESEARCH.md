# API Research — Do This BEFORE Writing Any Tool

The single biggest unknown. **Whiteboard apps often do not mutate boards over plain
REST** — they use a realtime channel (websocket/CRDT/operational-transform), and the
REST API is read-only or limited to board-level CRUD (create/rename/delete a board, but
not "add a sticky note"). Resolve this before committing to a design.

## Step 1 — Discover write endpoints (blocking; do first)

Sources, in order of preference:

1. **Official docs:** https://spreo.io/developers — look for the v2 endpoint list.
   Find any POST/PUT/PATCH/DELETE. Note exact endpoint names (they're dotted RPC style,
   e.g. `boards.create`, `pods.snapshots.update`, `instances.create`).
2. **The realtime question — answer explicitly:** Search the docs for "websocket",
   "realtime", "collaboration", "sync", "CRDT", "socket.io". If board *content* is only
   mutated over a socket, a REST-based MCP write tool for stickies is **not feasible as
   scoped** — escalate to the user with options (see "If REST can't write content").
3. **Probe from the existing key** (read-only, safe): the account already authenticates.
   With `SPREO_API_KEY` set, the existing read endpoints work. Try low-risk discovery:
   - `GET https://spreo.io/api/v2/pods.snapshots?podId=<id>` already works (see api.ts).
   - Check whether a `pods.snapshots.update` / `pods.patch` / `instances.*` endpoint
     exists (a 404 vs 405 vs 400 tells you if the route exists).
   **Do not POST mutations against a real board during discovery.** Create a throwaway
   board first (see Step 2) or use a dedicated scratch board the user provides.

Write your findings into a short `FINDINGS.md` in this folder before coding.

## Step 2 — Establish the safest write primitive first

Order write capabilities from lowest to highest risk. Implement and verify in this order:

1. **`create_board`** (if it exists) — board-level create is usually a clean REST call
   and gives you a disposable target for all further testing. Lowest blast radius.
2. **Add a single item** (one sticky/text) to a board — the core capability.
3. **Add a section** (header Shape + container Shape + children) — composed of (2),
   plus `childLinks` wiring. Highest complexity.

Do not attempt (2)/(3) until Step 1 confirms the transport.

## Step 3 — The payload mapping (if REST content-writes exist)

You are inverting `src/snapshot.ts`. To create one item you must supply:
- an `instances[id] = { type: "Sticky" | "Text" | ... }` entry,
- a `states[id]` entry with at least `x`, `y`, and a content key (`content` is the
  primary one the parser reads; confirm which key the API expects on write),
- for grouped items: a `childLinks[parentId][id]` link and/or `parentLinks[id]`,
- likely the current `version` for optimistic concurrency (fetch snapshot first, send
  version, handle version-conflict errors).
- an **ID**: determine whether the client generates IDs (uuid?) or the server does.
  Inspect real IDs from a `pods.snapshots` response to match the format.

**Validation loop (required):** after every write, call the existing
`api.getBoardSnapshot()` + `parseSnapshot()` (or the `get_board_content` tool) and
assert the new item reads back. A write that returns 200 but doesn't render is the
expected failure mode here.

## If REST can't write content (realtime-only)

Do not silently build something that half-works. Escalate with these options for the user:
- **A. Board-level only:** ship `create_board` + rename/delete if REST supports it;
  content still authored by humans. Low value but honest.
- **B. Realtime client:** implement the websocket/CRDT protocol. Large scope; likely a
  separate project. Flag effort explicitly.
- **C. Import/template route:** some boards support create-from-template or bulk import
  (e.g. a snapshot upload). If `pods.snapshots` has a write counterpart that accepts a
  full snapshot, generating a whole board at once may be *easier* than per-item writes.
  Check for this — it may be the best fit for the "generate a board from an outline" use case.

Recommend C if it exists — it matches the actual use case (produce a full board from a
briefing) and avoids per-item realtime complexity.
