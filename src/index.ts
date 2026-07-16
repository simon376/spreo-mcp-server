#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { pdf } from "pdf-to-img";
import sharp from "sharp";
import * as api from "./api.js";
import { parseSnapshot, formatParsedBoard, extractFrames } from "./snapshot.js";

const server = new McpServer(
  { name: "spreo", version: "1.1.0" },
  {
    instructions:
      "Access to Spreo boards (formerly Ludi / Metro Retro). Reads are unrestricted: use list_boards to find boards, then get_board_content to read their content (returned as pre-parsed structured text with sections and items). Use list_frames to discover frames on a board and get_frame_image to render a frame as a cropped PNG image (may take 30-60s). Writes are limited to creating boards: use list_templates to find a fitting template (e.g. for a meeting or workshop), then create_board to spin up a new board from that template (or from BLANK). The server CANNOT add individual items to a board, nor edit or delete existing content — board content is only editable in the Spreo app itself.",
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
    includeIds: z
      .boolean()
      .optional()
      .describe("Include item and section IDs in the output (default false). Useful for cross-referencing with frames or export URLs."),
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

      const text = formatParsedBoard(parsed, info.label, {
        includeIds: params.includeIds,
      });
      return { content: [{ type: "text", text }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// --- list_frames ---

server.tool(
  "list_frames",
  {
    boardId: z.string().describe("Board ID (from list_boards)"),
  },
  async (params) => {
    try {
      const info = await api.getBoardInfo(params.boardId);
      const snapshot = await api.getBoardSnapshot(info.podId);
      const frames = extractFrames(snapshot);

      if (frames.length === 0) {
        return { content: [{ type: "text", text: "No frames found on this board." }] };
      }

      const lines = [`Found ${frames.length} frames on **${info.label}**:\n`];
      for (const f of frames) {
        lines.push(`- **${f.title}** (ID: ${f.id})`);
        lines.push(`  Items: ${f.itemCount} | Position: (${f.x}, ${f.y})`);
        lines.push(`  PDF export: https://spreo.io/${params.boardId}.pdf?targets=%5B${f.id}%5D`);
      }
      lines.push("");
      lines.push(`Full board PDF: https://spreo.io/${params.boardId}.pdf`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- get_frame_image ---

server.tool(
  "get_frame_image",
  "Render a board frame as a cropped PNG image. Fetches the Spreo PDF export, converts to PNG, and auto-crops the light-blue background. IMPORTANT: Each call triggers a server-side PDF render that sends an email notification to the board owner (\"Your PDF export is ready\", available for 7 days). Use list_frames first to get frame IDs. Prefer exporting individual frames — full-board export can take minutes and produce huge images. Best called from a background agent.",
  {
    boardId: z.string().describe("Board ID (from list_boards)"),
    frameId: z
      .string()
      .optional()
      .describe("Frame ID to export (from list_frames). STRONGLY recommended — omitting this exports the full board which can take minutes and produce unreadably large images."),
    scale: z
      .number()
      .optional()
      .describe("PDF rendering scale factor (default 2.0). Higher = sharper but larger. Range 1-4."),
    confirmFullBoard: z
      .boolean()
      .optional()
      .describe("Must be set to true when frameId is omitted. This is a safety flag to confirm you intentionally want the full board export (which is slow and sends an email notification)."),
  },
  async (params) => {
    try {
      if (!params.frameId && !params.confirmFullBoard) {
        return {
          content: [{
            type: "text",
            text: "⚠️ No frameId provided. Full-board PDF export can take several minutes and will send an email notification to the board owner. If you really want the full board, set confirmFullBoard: true. Otherwise, use list_frames first to pick a specific frame.",
          }],
          isError: true,
        };
      }

      const pdfUrl = params.frameId
        ? `https://spreo.io/${params.boardId}.pdf?targets=%5B${params.frameId}%5D`
        : `https://spreo.io/${params.boardId}.pdf`;

      const res = await fetch(pdfUrl, {
        headers: { Authorization: `Bearer ${api.getApiKey()}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`PDF export failed (${res.status}): ${body}`);
      }

      const pdfBuffer = Buffer.from(await res.arrayBuffer());
      const scale = Math.min(4, Math.max(1, params.scale ?? 2));

      const doc = await pdf(pdfBuffer, { scale });
      const pages: Buffer[] = [];
      for await (const page of doc) {
        pages.push(Buffer.from(page));
      }

      if (pages.length === 0) {
        throw new Error("PDF conversion produced no pages");
      }

      // Auto-crop each page: trim the light-blue background (#eef2f8 ≈ rgb(238,242,248))
      // sharp.trim() removes borders that are similar to the top-left pixel color
      const cropped: Buffer[] = [];
      for (const png of pages) {
        const trimmed = await sharp(png)
          .trim({ threshold: 20 })
          .png()
          .toBuffer();
        cropped.push(trimmed);
      }

      const content = cropped.map((png) => ({
        type: "image" as const,
        data: png.toString("base64"),
        mimeType: "image/png" as const,
      }));

      const header = {
        type: "text" as const,
        text: `Rendered ${cropped.length} page(s) from ${params.frameId ? `frame ${params.frameId}` : "full board"} of board ${params.boardId}.`,
      };

      return { content: [header, ...content] };
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
  "List board participants. With visual: true, also returns a legend image showing avatars, names, initials, and colors — useful alongside get_frame_image to identify who placed which items.",
  {
    boardId: z.string().describe("Board ID"),
    visual: z
      .boolean()
      .optional()
      .describe("If true, also return a visual legend image with avatars, names, and colors (default false)."),
  },
  async (params) => {
    try {
      const participants = await api.getBoardParticipants(params.boardId);
      const list = Array.isArray(participants) ? participants : [];

      const lines = [`${list.length} participants:\n`];
      for (const p of list) {
        const id = p.id || p.userId || "?";
        lines.push(`- **${p.name}** (ID: ${id}, initials: ${p.initials || "?"}, color: ${p.color || "?"})`);
      }

      const textContent = { type: "text" as const, text: lines.join("\n") };

      if (!params.visual) {
        return { content: [textContent] };
      }

      // Build visual legend
      const ROW_HEIGHT = 64;
      const AVATAR_SIZE = 48;
      const PADDING = 12;
      const WIDTH = 400;
      const height = list.length * ROW_HEIGHT + PADDING * 2;

      const avatarBuffers = await Promise.all(
        list.map(async (p) => {
          if (!p.photo) return null;
          try {
            const res = await fetch(p.photo);
            if (!res.ok) return null;
            return Buffer.from(await res.arrayBuffer());
          } catch {
            return null;
          }
        })
      );

      const processedAvatars = await Promise.all(
        avatarBuffers.map(async (buf) => {
          if (!buf) return null;
          const circleClip = Buffer.from(
            `<svg><circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="white"/></svg>`
          );
          return sharp(buf)
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
            .composite([{ input: circleClip, blend: "dest-in" }])
            .png()
            .toBuffer();
        })
      );

      const svgRows = list.map((p, i) => {
        const y = PADDING + i * ROW_HEIGHT;
        const textY = y + AVATAR_SIZE / 2 + 6;
        const color = p.color || "#666";
        const initials = p.initials || "?";
        const name = p.name || "Unknown";
        const id = p.id || p.userId || "?";
        return `
          <circle cx="${PADDING + AVATAR_SIZE + 12}" cy="${y + AVATAR_SIZE / 2}" r="8" fill="${color}"/>
          <text x="${PADDING + AVATAR_SIZE + 28}" y="${textY}" font-family="Arial, sans-serif" font-size="16" fill="#333">${escapeXml(name)}</text>
          <text x="${PADDING + AVATAR_SIZE + 28}" y="${textY + 18}" font-family="Arial, sans-serif" font-size="12" fill="#999">${escapeXml(initials)} · ${escapeXml(id)}</text>
        `;
      }).join("");

      const svgOverlay = Buffer.from(
        `<svg width="${WIDTH}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${WIDTH}" height="${height}" fill="white"/>
          ${svgRows}
        </svg>`
      );

      const composites = processedAvatars.map((buf, i) => {
        if (!buf) return null;
        return {
          input: buf,
          top: PADDING + i * ROW_HEIGHT + Math.floor((ROW_HEIGHT - AVATAR_SIZE) / 2),
          left: PADDING,
        };
      }).filter((c): c is NonNullable<typeof c> => c !== null);

      const legend = await sharp(svgOverlay)
        .composite(composites)
        .png()
        .toBuffer();

      return {
        content: [
          textContent,
          { type: "image" as const, data: legend.toString("base64"), mimeType: "image/png" as const },
        ],
      };
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
