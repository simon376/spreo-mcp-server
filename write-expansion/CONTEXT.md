# Context — Current State of the Codebase

Read this first. It tells you exactly what exists so you don't rebuild it.

## Repo facts

- Path: `/Users/simonstieber/code/spreo-mcp-server`
- Remote: `gitlab` → `https://gitlab.xitaso.com/aithena/spreo-mcp-server.git`
- Branch: `main`. **Create a feature branch for this work.**
- ESM project (`"type": "module"`), TypeScript ES2022, Node16 module resolution.
- Deps: `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.3.6` (imported as `zod/v4`).
- No tests, no linter configured. Build with `npm run build` (tsc → `dist/`), run with `npm start`.
- Auth: `SPREO_API_KEY` env (falls back to `LUDI_API_KEY`). Bearer token.
- API base: `https://spreo.io/api/v2`. Product was renamed Ludi → Spreo (July 2026).

## The three source files (~450 lines total)

### `src/api.ts` — HTTP client + types
- `request<T>(endpoint, params)` — GET-style helper, params → query string.
- **`post<T>(endpoint, body)` — ALREADY EXISTS (lines ~33–49) but is UNUSED.**
  This is your write transport if the API turns out to be plain REST. It sets
  `Content-Type: application/json`, Bearer auth, JSON body, throws on `!res.ok`.
  **Reuse it. Do not write a second HTTP helper.**
- Existing read functions all hit dotted RPC-style endpoints: `boards.list2`,
  `boards.info`, `pods.snapshots`, `boards.participants.list`, `workspaces.list`,
  `workspaces.info`, `users.info`, `users.list2`, `tasks.list`.
  → Write endpoints are very likely the same style (e.g. `pods.*`, `boards.create`,
  `instances.create` — UNVERIFIED, see API-RESEARCH.md).
- Exported interfaces you'll need: `Snapshot`, `BoardInfo`, `BoardListItem`.

### `src/index.ts` — MCP server + tool registration
- Creates `McpServer({ name: "spreo-readonly", version: "1.0.0" }, { instructions })`.
- Registers 6 read tools with `server.tool(name, zodShape, handler)`.
- **Every handler follows the same pattern** — copy it exactly for new tools:
  ```ts
  server.tool("tool_name", { param: z.string().describe("...") }, async (params) => {
    try {
      const result = await api.someFn(params);
      return { content: [{ type: "text", text: /* markdown */ }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });
  ```
- **The `instructions` string (lines ~12–14) hardcodes "read-only ... cannot create,
  modify, or delete anything."** This MUST be rewritten when write tools land, or the
  host advertises a false capability. Also update `name` if you keep `-readonly` in it.

### `src/snapshot.ts` — the board data model (CRITICAL for writes)
- Read-direction parser. It reveals the **exact shape you must produce to write.**
- A Spreo board snapshot is a **flat** structure (`Snapshot` interface in api.ts):
  - `instances: Record<id, { type: string; variant?: string }>` — what each object *is*
    (types seen: `Sticky`, `Text`, `Shape`, `Graphic`, `Token`, `IndexCard`, `root`).
  - `states: Record<id, Record<string, unknown>>` — per-object position/content.
    Known keys: `x`, `y`, `content` (or `content|value` / `value` / `text` / `url`),
    `background`, `userId`, `created`.
  - `childLinks: Record<parentId, Record<childId, string>>` — hierarchy.
  - `parentLinks: Record<childId, parentId>` — reverse hierarchy.
  - `version: number` — snapshot version (likely used for optimistic concurrency).
- **Sections are not first-class.** They're inferred: a labeled `Shape` header ("#1
  Intro") + an unlabeled container `Shape` with children at a similar y-coordinate.
  → To "create a section" you must create a labeled Shape + a container Shape + child
  items and wire the `childLinks`. This is the reverse of `parseSnapshot()`.

## What this means for the implementation

The MCP/tool layer is trivial (copy the existing pattern). The two real problems are:

1. **Transport:** Does Spreo expose a REST write endpoint at all, or do boards mutate
   over a realtime/websocket protocol (many whiteboard products do)? → `API-RESEARCH.md`.
2. **Payload:** Constructing valid `instances` + `states` + `childLinks` entries — with
   IDs, coordinates, and the version field — so the item renders. This is reverse-
   engineering; budget most of the effort here. Validate by round-tripping: write an
   item, then call the existing `get_board_content` and confirm it reads back.
