# spreo-mcp-server

MCP server that gives AI assistants access to [Spreo](https://spreo.io/) boards (formerly Ludi / Metro Retro): read board content, and create new boards from templates.

> **Rename note:** the product was renamed **Ludi → Spreo** (July 2026). The API now lives at `spreo.io` (`ludi.co` still 301-redirects) and the API-key env var is **`SPREO_API_KEY`** (the old `LUDI_API_KEY` is still accepted as a fallback).

## Tools

| Tool | Description |
|------|-------------|
| `list_boards` | Search and browse boards by name or workspace |
| `get_board_content` | Read full board content — parsed into sections with stickies, text, cards. Supports filtering by item type and section name. |
| `list_workspaces` | List all workspaces |
| `get_board_participants` | See who's on a board |
| `resolve_users` | Look up users by name or ID |
| `list_tasks` | List action items for a workspace |
| `list_templates` | Search board templates by keyword (title, description, tags) — e.g. find a template for a meeting or retro |
| `create_board` | Create a new board from a template (or blank) in a workspace |

The read tools are unrestricted. The only write capability is **creating boards** (blank or from a template). The server cannot add individual items to a board, nor edit or delete existing boards or their content — board content is only editable in the Spreo app itself.

> **Why write support is limited to board creation:** Spreo's REST API v2 exposes only board-level writes (`boards.create`, and cloning from a template). Board *canvas content* (stickies, text, shapes) is not REST-writable — it lives in a realtime transaction-log / CRDT model that is only mutated over Spreo's collaboration channel. Creating a board from a template does populate it synchronously (the template's content is cloned server-side), so template cloning is the supported way to produce a pre-authored board layout.

## Setup

### 1. Get your Spreo API key

Log in to https://spreo.io/developers and copy your API key.

### 2. Build

```bash
git clone https://github.com/s1st/spreo-mcp-server.git
cd spreo-mcp-server
npm install
npm run build
```

### 3. Configure in Claude Code

Add to `~/.claude/.mcp.json`:

```json
{
  "spreo": {
    "command": "node",
    "args": ["/path/to/spreo-mcp-server/dist/index.js"],
    "env": {
      "SPREO_API_KEY": "your-api-key-here"
    }
  }
}
```

Restart Claude Code. The tools will be available automatically.

## Usage examples

Once connected, just talk to Claude naturally:

- "What boards do we have in my workspace?"
- "Show me the content of the Kick-Off board"
- "Extract the action items and contacts from that board"
- "Who participated in the last retro?"
- "Show me only the stickies from the Risks section"
- "Find a good template for a customer discovery meeting and create a board from it in my workspace"

## How it works

```
boards.list2   →  find board by name/workspace
boards.info    →  get podId for a board
pods.snapshots →  get full board content as flat JSON
```

The snapshot contains all items (Stickies, Text, Shapes, IndexCards, Tokens, etc.) with their positions and hierarchical relationships.

The parser identifies sections by:
1. Finding labeled Shape headers (e.g. "#1 Introduction")
2. Finding unlabeled container Shapes at the same y-level that hold the actual content
3. Using `childLinks` to recursively collect all items inside those containers

This matches how Spreo organizes boards — items placed inside a zone Shape become its children.

## Known limitations

- **Floating items**: Stickies placed outside any zone container show up as "Ungrouped"
- **Reactions**: Emoji reactions show as unicode codepoints (e.g. `2705` instead of ✅)
- **Tasks API**: The `list_tasks` endpoint currently returns a 500 error on Spreo's side — the tool will work once they fix it

## Tech

- TypeScript + [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Spreo API v2 (Bearer token auth)
- ~200 lines of code

## Spreo API docs

Full API reference (requires login): https://spreo.io/developers
