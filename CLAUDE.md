# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Read-only MCP server that exposes [Spreo](https://spreo.io/) (formerly Ludi / Metro Retro) boards to AI assistants via the Model Context Protocol. All six tools are read-only — the server cannot create, modify, or delete anything in Spreo.

> **Rename:** product renamed Ludi → Spreo (July 2026). API at `spreo.io/api/v2` (`ludi.co` still 301-redirects); key env var is `SPREO_API_KEY` (old `LUDI_API_KEY` accepted as fallback in `api.ts`).

## Commands

```bash
npm install        # install dependencies
npm run build      # compile TypeScript → dist/
npm start          # run the compiled server (stdio transport)
```

There are no tests or linting configured.

## Architecture

Three source files, ~450 lines total:

- **`src/index.ts`** — MCP server entry point. Registers six tools (`list_boards`, `get_board_content`, `list_workspaces`, `get_board_participants`, `resolve_users`, `list_tasks`) using `@modelcontextprotocol/sdk`. Each tool handler calls the API layer, formats output as markdown text, and returns it.
- **`src/api.ts`** — Thin HTTP client for the Spreo REST API v2 (`spreo.io/api/v2`). All requests use Bearer token auth via `SPREO_API_KEY` env var (falls back to `LUDI_API_KEY`). Exports typed functions (`listBoards`, `getBoardInfo`, `getBoardSnapshot`, etc.) and all API response interfaces.
- **`src/snapshot.ts`** — Board snapshot parser. Converts the flat snapshot JSON (instances, states, childLinks, parentLinks) into structured sections with items. The key logic: finds labeled Shape headers, matches them to nearby unlabeled container Shapes by y-coordinate range, then recursively collects descendants via `childLinks`. Supports filtering by item type and section title.

## Key Concepts

- **Snapshot structure**: Spreo boards are stored as a flat map of instances (type info), states (position/content), and childLinks (parent→child relationships). The parser in `snapshot.ts` reconstructs the visual hierarchy from these.
- **Section detection**: Sections are identified by finding Shapes with text content (headers like "#1 Introduction"), then finding empty Shapes at similar y-levels that contain child items.
- **Transport**: Uses stdio (`StdioServerTransport`), designed to be launched by an MCP host (e.g., Claude Code via `.mcp.json`).

## Environment

- `SPREO_API_KEY` (required) — Spreo API Bearer token from https://spreo.io/developers (old `LUDI_API_KEY` still accepted as fallback)
- ESM project (`"type": "module"` in package.json), TypeScript targets ES2022 with Node16 module resolution
- Zod v4 used for tool parameter schemas (imported as `zod/v4`)
