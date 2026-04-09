#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import * as api from "./api.js";
import { parseSnapshot, formatParsedBoard } from "./snapshot.js";

const server = new McpServer(
  { name: "ludi-readonly", version: "1.0.0" },
  {
    instructions:
      "Read-only access to Ludi boards. This server can only READ data — it cannot create, modify, or delete anything. Use list_boards to find boards, then get_board_content to read their content. Board content is returned as pre-parsed structured text with sections and items.",
  }
);

// --- list_boards ---

server.tool(
  "list_boards",
  {
    search: z.string().optional().describe("Search term to filter boards by name"),
    workspaceId: z.string().optional().describe("Filter by workspace ID"),
    limit: z.string().optional().describe("Max results (default 25)"),
  },
  async (params) => {
    try {
      const result = await api.listBoards({
        search: params.search,
        workspaceId: params.workspaceId,
        limit: params.limit,
      });

      const boardList = result.items ?? [];

      const lines = [`Found ${boardList.length} boards:\n`];
      for (const b of boardList) {
        const updated = new Date(b.updatedAt).toLocaleDateString("de-DE");
        lines.push(`- **${b.label}** (ID: ${b.id})`);
        lines.push(`  Workspace: ${b.workspaceLabel} | Updated: ${updated}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- get_board_content ---

server.tool(
  "get_board_content",
  {
    boardId: z.string().describe("Board ID (from list_boards)"),
    types: z
      .string()
      .optional()
      .describe("Comma-separated item types to filter (e.g. 'Sticky,Text'). Available: Sticky, Text, Shape, Graphic, Token, IndexCard"),
    section: z
      .string()
      .optional()
      .describe("Filter to a specific section by title (substring match)"),
  },
  async (params) => {
    try {
      const info = await api.getBoardInfo(params.boardId);
      const snapshot = await api.getBoardSnapshot(info.podId);

      const typeFilter = params.types
        ? params.types.split(",").map((t) => t.trim())
        : undefined;

      const parsed = parseSnapshot(snapshot, {
        types: typeFilter,
        sectionTitle: params.section,
      });

      const text = formatParsedBoard(parsed, info.label);
      return { content: [{ type: "text", text }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- list_workspaces ---

server.tool("list_workspaces", {}, async () => {
  try {
    const workspaces = await api.listWorkspaces();
    const wsList = Array.isArray(workspaces) ? workspaces : [];

    const lines = [`Found ${wsList.length} workspaces:\n`];
    for (const ws of wsList) {
      lines.push(`- **${ws.label}** (ID: ${ws.id}, type: ${ws.type})`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
  }
});

// --- get_board_participants ---

server.tool(
  "get_board_participants",
  {
    boardId: z.string().describe("Board ID"),
  },
  async (params) => {
    try {
      const participants = await api.getBoardParticipants(params.boardId);
      const list = Array.isArray(participants) ? participants : [];

      const lines = [`${list.length} participants:\n`];
      for (const p of list) {
        const id = p.userId || (p as unknown as Record<string, string>).id || "?";
        lines.push(`- **${p.name}** (ID: ${id})`);

      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- resolve_users ---

server.tool(
  "resolve_users",
  {
    userIds: z
      .string()
      .optional()
      .describe("Comma-separated user IDs to resolve"),
    search: z.string().optional().describe("Search users by name"),
  },
  async (params) => {
    try {
      if (params.userIds) {
        const ids = params.userIds.split(",").map((id) => id.trim());
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const user = await api.getUserInfo(id);
              return `- **${user.name}** (ID: ${user.id}${user.email ? `, ${user.email}` : ""})`;
            } catch {
              return `- Unknown user (ID: ${id})`;
            }
          })
        );
        return { content: [{ type: "text", text: results.join("\n") }] };
      }

      if (params.search) {
        const result = await api.listUsers(params.search);
        const users = result.users ?? result;
        const list = Array.isArray(users) ? users : [];
        const lines = list.map(
          (u) => `- **${u.name}** (ID: ${u.id}${u.email ? `, ${u.email}` : ""})`
        );
        return {
          content: [{ type: "text", text: lines.length ? lines.join("\n") : "No users found" }],
        };
      }

      return { content: [{ type: "text", text: "Provide either userIds or search parameter" }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- list_tasks ---

server.tool(
  "list_tasks",
  {
    workspaceId: z.string().describe("Workspace ID to list tasks for"),
    search: z.string().optional().describe("Search term to filter tasks"),
  },
  async (params) => {
    try {
      const result = await api.listTasks({
        workspaceId: params.workspaceId,
        search: params.search,
      });

      const list = result.items ?? (result as unknown as api.TaskItem[]) ?? [];

      if (list.length === 0) {
        return { content: [{ type: "text", text: "No tasks found" }] };
      }

      const lines = [`${list.length} tasks:\n`];
      for (const t of list) {
        const due = t.dueDate ? ` | Due: ${new Date(t.dueDate).toLocaleDateString("de-DE")}` : "";
        const board = t.boardLabel ? ` | Board: ${t.boardLabel}` : "";
        lines.push(`- [${t.status}] **${t.summary}**${due}${board}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ludi MCP server (read-only) running on stdio");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
