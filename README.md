# ludi-mcp-server (read-only)

MCP server that gives AI assistants read-only access to [Ludi](https://ludi.co/) boards (formerly Metro Retro).

## Tools

| Tool | Description |
|------|-------------|
| `list_boards` | Search and browse boards by name or workspace |
| `get_board_content` | Read full board content — parsed into sections with stickies, text, cards. Supports filtering by item type and section name. |
| `list_workspaces` | List all workspaces |
| `get_board_participants` | See who's on a board |
| `resolve_users` | Look up users by name or ID |
| `list_tasks` | List action items for a workspace |

All tools are **read-only**. The server cannot create, modify, or delete anything.

## Setup

### 1. Get your Ludi API key

Log in to https://ludi.co/developers and copy your API key.

### 2. Build

```bash
git clone https://github.com/s1st/ludi-mcp-server.git
cd ludi-mcp-server
npm install
npm run build
```

### 3. Configure in Claude Code

Add to `~/.claude/.mcp.json`:

```json
{
  "ludi": {
    "command": "node",
    "args": ["/path/to/ludi-mcp-server/dist/index.js"],
    "env": {
      "LUDI_API_KEY": "your-api-key-here"
    }
  }
}
```

Restart Claude Code. The tools will be available automatically.

## Usage examples

Once connected, just talk to Claude naturally:

- "What boards do we have in Team AIthena?"
- "Show me the content of the Kick-Off board"
- "Extract the action items and contacts from that board"
- "Who participated in the last retro?"
- "Show me only the stickies from the Risks section"

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

This matches how Ludi organizes boards — items placed inside a zone Shape become its children.

## Known limitations

- **Floating items**: Stickies placed outside any zone container show up as "Ungrouped"
- **Reactions**: Emoji reactions show as unicode codepoints (e.g. `2705` instead of ✅)
- **Tasks API**: The `list_tasks` endpoint currently returns a 500 error on Ludi's side — the tool will work once they fix it

## Tech

- TypeScript + [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Ludi API v2 (Bearer token auth)
- ~200 lines of code

## Ludi API docs

Full API reference (requires login): https://ludi.co/developers
