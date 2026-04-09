import type { Snapshot } from "./api.js";

export interface ParsedItem {
  id: string;
  type: string;
  content: string;
  x: number;
  y: number;
  background?: string;
  userId?: string;
  created?: string;
}

export interface BoardSection {
  id: string;
  title: string;
  y: number;
  items: ParsedItem[];
}

export interface ParsedBoard {
  version: number;
  totalItems: number;
  typeCounts: Record<string, number>;
  sections: BoardSection[];
  ungrouped: ParsedItem[];
}

function extractText(state: Record<string, unknown>): string {
  return (
    (state["content"] as string) ||
    (state["content|value"] as string) ||
    (state["value"] as string) ||
    (state["text"] as string) ||
    ""
  );
}

function cleanSectionTitle(raw: string): string {
  // Remove numbering like "#1\n\n" and collapse newlines
  return raw.replace(/^#\d+\s*/g, "").replace(/\n+/g, " ").trim();
}

export function parseSnapshot(
  snapshot: Snapshot,
  filters?: {
    types?: string[];
    sectionTitle?: string;
  }
): ParsedBoard {
  const { instances, states } = snapshot;

  // Count types
  const typeCounts: Record<string, number> = {};
  for (const inst of Object.values(instances)) {
    typeCounts[inst.type] = (typeCounts[inst.type] || 0) + 1;
  }

  // Extract all items with content
  const allItems: ParsedItem[] = [];
  for (const [id, state] of Object.entries(states)) {
    const inst = instances[id];
    if (!inst || inst.type === "root") continue;

    const content = extractText(state);
    if (!content) continue;

    allItems.push({
      id,
      type: inst.type,
      content: content.trim(),
      x: (state["x"] as number) || 0,
      y: (state["y"] as number) || 0,
      background: state["background"] as string | undefined,
      userId: state["userId"] as string | undefined,
      created: state["created"] as string | undefined,
    });
  }

  // Identify section headers: Shapes with content, sorted by y-position
  const sectionHeaders = allItems
    .filter((i) => i.type === "Shape" && i.content)
    .sort((a, b) => a.y - b.y);

  // Non-shape items with content
  const contentItems = allItems
    .filter((i) => i.type !== "Shape")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Assign items to sections by y-range
  // Each section spans from its y to the next section's y
  const sections: BoardSection[] = [];
  const assignedIds = new Set<string>();

  for (let i = 0; i < sectionHeaders.length; i++) {
    const header = sectionHeaders[i];
    const nextHeader = sectionHeaders[i + 1];
    const yStart = header.y;
    const yEnd = nextHeader ? nextHeader.y : Infinity;

    const sectionItems: ParsedItem[] = [];
    for (const item of contentItems) {
      if (item.y >= yStart && item.y < yEnd) {
        sectionItems.push(item);
        assignedIds.add(item.id);
      }
    }

    sections.push({
      id: header.id,
      title: cleanSectionTitle(header.content),
      y: header.y,
      items: sectionItems,
    });
  }

  // Ungrouped: items before the first section
  const ungrouped = contentItems.filter((i) => !assignedIds.has(i.id));

  // Apply filters
  let filteredSections = sections;
  let filteredUngrouped = ungrouped;

  if (filters?.sectionTitle) {
    const search = filters.sectionTitle.toLowerCase();
    filteredSections = sections.filter((s) =>
      s.title.toLowerCase().includes(search)
    );
    filteredUngrouped = [];
  }

  if (filters?.types) {
    const allowedTypes = new Set(filters.types.map((t) => t.toLowerCase()));
    filteredSections = filteredSections.map((s) => ({
      ...s,
      items: s.items.filter((i) => allowedTypes.has(i.type.toLowerCase())),
    }));
    filteredUngrouped = filteredUngrouped.filter((i) =>
      allowedTypes.has(i.type.toLowerCase())
    );
  }

  return {
    version: snapshot.version,
    totalItems: Object.keys(instances).length,
    typeCounts,
    sections: filteredSections,
    ungrouped: filteredUngrouped,
  };
}

export function formatParsedBoard(
  board: ParsedBoard,
  boardName: string
): string {
  const lines: string[] = [];

  lines.push(`## Board: ${boardName}`);
  lines.push(`**Items:** ${board.totalItems} | **Version:** ${board.version}`);
  lines.push(
    `**Types:** ${Object.entries(board.typeCounts)
      .map(([t, c]) => `${t}: ${c}`)
      .join(", ")}`
  );
  lines.push("");

  for (const section of board.sections) {
    lines.push(`### ${section.title}`);
    for (const item of section.items) {
      if (item.content) {
        const content = item.content.replace(/\n/g, " ");
        const prefix = item.type === "Text" ? "" : `[${item.type}] `;
        lines.push(`- ${prefix}${content}`);
      }
    }
    lines.push("");
  }

  if (board.ungrouped.length > 0) {
    lines.push("### Ungrouped");
    for (const item of board.ungrouped) {
      const content = item.content.replace(/\n/g, " ");
      const prefix = item.type === "Text" ? "" : `[${item.type}] `;
      lines.push(`- ${prefix}${content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
