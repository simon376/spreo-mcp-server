#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import * as api from "./api.js";
import { parseSnapshot, formatParsedBoard } from "./snapshot.js";

const server = new McpServer(
  { name: "spreo", version: "1.1.0" },
  {
    instructions:
      "Access to Spreo boards (formerly Ludi / Metro Retro). Reads are unrestricted: use list_boards to find boards, then get_board_content to read their content (returned as pre-parsed structured text with sections and items). Writes are limited to creating boards: use list_templates to find a fitting template (e.g. for a meeting or workshop), then create_board to spin up a new board from that template (or from BLANK). The server CANNOT add individual items to a board, nor edit or delete existing content — board content is only editable in the Spreo app itself.",
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

// --- list_templates ---

server.tool(
  "list_templates",
  {
    search: z
      .string()
      .optional()
      .describe(
        "Keyword(s) to match against template title, description, and tags (e.g. 'sales meeting', 'retro', 'planning'). Space-separated terms must all match. Omit to list all."
      ),
    teamOnly: z
      .boolean()
      .optional()
      .describe("Only return account/team-owned templates (default false = all templates)"),
    limit: z.number().optional().describe("Max results to return (default 25)"),
  },
  async (params) => {
    try {
      const templates = await api.listTemplates(params.teamOnly);
      const all = Array.isArray(templates) ? templates : [];

      const terms = (params.search ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      const matches = all.filter((t) => {
        if (terms.length === 0) return true;
        const haystack = [
          t.label,
          t.description,
          ...(t.tags ?? []).map((tag) => tag.label),
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });

      const limit = params.limit ?? 25;
      const shown = matches.slice(0, limit);

      if (shown.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: params.search
                ? `No templates match "${params.search}".`
                : "No templates found.",
            },
          ],
        };
      }

      const header =
        matches.length > shown.length
          ? `Found ${matches.length} matching templates (showing ${shown.length}):\n`
          : `Found ${shown.length} templates:\n`;
      const lines = [header];
      for (const t of shown) {
        const tags = (t.tags ?? []).map((tag) => tag.label).join(", ");
        const owned = t.accountId ? " [team]" : "";
        lines.push(`- **${t.label}**${owned} (ID: ${t.id})`);
        if (t.description) lines.push(`  ${t.description}`);
        if (tags) lines.push(`  Tags: ${tags}`);
      }
      lines.push("\nUse create_board with source=<template ID> to create a board from one.");

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- create_board ---

server.tool(
  "create_board",
  {
    label: z.string().describe("Name for the new board"),
    workspaceId: z.string().describe("Workspace ID to create the board in (from list_workspaces)"),
    source: z
      .string()
      .optional()
      .describe(
        "'BLANK' for an empty board, or a template ID (from list_templates) to clone that template's content. Defaults to BLANK."
      ),
    folderId: z.string().optional().describe("Optional folder ID within the workspace"),
  },
  async (params) => {
    try {
      const source = params.source ?? "BLANK";
      const board = await api.createBoard({
        source,
        label: params.label,
        workspaceId: params.workspaceId,
        folderId: params.folderId,
      });

      // Verify: read the board back and report what actually landed on it.
      let verification = "";
      try {
        const snapshot = await api.getBoardSnapshot(board.podId);
        const itemCount = Object.keys(snapshot.instances ?? {}).length;
        verification =
          source === "BLANK"
            ? `\nVerified: board is reachable (${itemCount} instances, expected empty).`
            : `\nVerified: template content copied — ${itemCount} items on the board.`;
        if (source !== "BLANK" && itemCount === 0) {
          verification =
            "\n⚠️ Warning: created from a template but the board read back empty. It may still be provisioning — check it in the Spreo app.";
        }
      } catch (verifyErr: unknown) {
        verification = `\n⚠️ Board was created but could not be read back to verify: ${(verifyErr as Error).message}`;
      }

      const lines = [
        `Created board **${board.label}** (ID: ${board.id}).`,
        `Source: ${source === "BLANK" ? "blank" : `template ${source}`}`,
        verification,
      ];
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
  console.error("Spreo MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
