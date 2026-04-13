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
    (state["url"] as string) ||
    ""
  );
}

function cleanSectionTitle(raw: string): string {
  return raw.replace(/^#\d+\s*/g, "").replace(/\n+/g, " ").trim();
}

/** Recursively collect all descendant IDs from childLinks */
function collectDescendants(
  id: string,
  childLinks: Record<string, Record<string, string>>,
  result: Set<string>
): void {
  const children = childLinks[id];
  if (!children) return;
  for (const childId of Object.keys(children)) {
    result.add(childId);
    collectDescendants(childId, childLinks, result);
  }
}

export function parseSnapshot(
  snapshot: Snapshot,
  filters?: {
    types?: string[];
    sectionTitle?: string;
  }
): ParsedBoard {
  const { instances, states, childLinks } = snapshot;

  // Count types
  const typeCounts: Record<string, number> = {};
  for (const inst of Object.values(instances)) {
    typeCounts[inst.type] = (typeCounts[inst.type] || 0) + 1;
  }

  // Build a map of all items with content
  const itemMap = new Map<string, ParsedItem>();
  for (const [id, state] of Object.entries(states)) {
    const inst = instances[id];
    if (!inst || inst.type === "root") continue;

    const content = extractText(state);
    if (!content) continue;

    itemMap.set(id, {
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

  // Identify labeled section headers (small Shapes with text like "#1 Introduction")
  const sectionHeaders: { id: string; title: string; y: number }[] = [];
  for (const [id, state] of Object.entries(states)) {
    const inst = instances[id];
    if (!inst || inst.type !== "Shape") continue;
    const content = extractText(state);
    if (!content) continue;
    sectionHeaders.push({
      id,
      title: cleanSectionTitle(content),
      y: (state["y"] as number) || 0,
    });
  }
  sectionHeaders.sort((a, b) => a.y - b.y);

  // Find unlabeled container Shapes (no text, have children) and group them by section
  // Strategy: for each section header, find containers at similar y-level (within y-range to next header)
  const assignedIds = new Set<string>();
  const sections: BoardSection[] = [];

  for (let i = 0; i < sectionHeaders.length; i++) {
    const header = sectionHeaders[i];
    const nextHeader = sectionHeaders[i + 1];
    const yStart = header.y - 100; // small tolerance
    const yEnd = nextHeader ? nextHeader.y - 100 : Infinity;

    // Find all container shapes in this y-range (unlabeled shapes with children)
    const containerIds: string[] = [];
    for (const [id, state] of Object.entries(states)) {
      const inst = instances[id];
      if (!inst || inst.type !== "Shape") continue;
      const content = extractText(state);
      if (content) continue; // skip labeled shapes (they're headers)
      const y = (state["y"] as number) || 0;
      const hasChildren = childLinks[id] && Object.keys(childLinks[id]).length > 0;
      if (hasChildren && y >= yStart && y < yEnd) {
        containerIds.push(id);
      }
    }

    // Collect all descendants of these containers
    const sectionDescendants = new Set<string>();
    for (const containerId of containerIds) {
      collectDescendants(containerId, childLinks, sectionDescendants);
    }

    // Build section items from descendants that have content
    const sectionItems: ParsedItem[] = [];
    for (const descId of sectionDescendants) {
      const item = itemMap.get(descId);
      if (item && item.type !== "Shape") {
        sectionItems.push(item);
        assignedIds.add(descId);
      }
    }

    // Also mark the header and containers as assigned
    assignedIds.add(header.id);
    for (const cid of containerIds) assignedIds.add(cid);

    sectionItems.sort((a, b) => a.y - b.y || a.x - b.x);

    sections.push({
      id: header.id,
      title: header.title,
      y: header.y,
      items: sectionItems,
    });
  }

  // Ungrouped: items not assigned to any section
  const ungrouped = [...itemMap.values()]
    .filter((i) => !assignedIds.has(i.id) && i.type !== "Shape")
    .sort((a, b) => a.y - b.y || a.x - b.x);

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
    if (section.items.length === 0) {
      lines.push("*(empty)*");
    }
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
