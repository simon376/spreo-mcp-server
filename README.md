# ludi-mcp-server (read-only)

MCP server that gives AI assistants read-only access to [Ludi](https://ludi.co/) boards (formerly Metro Retro).

## Tools

| Tool | Description |
|------|-------------|
| `list_boards` | Search and browse boards by name or workspace |
| `get_board_content` | Read full board content — parsed into sections with stickies, text, cards |
| `list_workspaces` | List all workspaces |
| `get_board_participants` | See who's on a board |
| `resolve_users` | Look up users by name or ID |
| `list_tasks` | List action items for a workspace |

All tools are **read-only**. The server cannot create, modify, or delete anything.

## Setup

### 1. Get your Ludi API key

Go to https://ludi.co/developers and copy your API key.

### 2. Build

```bash
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

## How it works

```
boards.list2  →  find board by name
boards.info   →  get podId
pods.snapshots →  get full board content (hierarchical JSON)
```

The snapshot parser groups items by section (using spatial position of Shape elements) and extracts text from Stickies, Text blocks, IndexCards, and Tokens.

## Tech

- TypeScript + [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Ludi API v2 (Bearer token auth)
- ~200 lines of code
