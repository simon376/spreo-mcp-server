// Spreo (formerly Ludi / Metro Retro). ludi.co still 301-redirects here, but we
// target the new domain directly. SPREO_API_KEY replaces the old LUDI_API_KEY;
// the old name is still accepted as a fallback so existing setups don't break.
const BASE_URL = "https://spreo.io/api/v2";

function getApiKey(): string {
  const key = process.env.SPREO_API_KEY ?? process.env.LUDI_API_KEY;
  if (!key)
    throw new Error("SPREO_API_KEY environment variable is not set (formerly LUDI_API_KEY)");
  return key;
}

async function request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spreo API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spreo API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// --- Types ---

export interface BoardListItem {
  id: string;
  label: string;
  workspaceId: string;
  workspaceLabel: string;
  workspaceType: string;
  folderId: string | null;
  thumbUrl: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface BoardInfo {
  id: string;
  name: string;
  label: string;
  type: number;
  userId: string;
  podId: string;
  password: boolean;
  viewers: string;
  joiners: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  workspaceId: string;
  workspaceType: string;
  folderId: string | null;
}

export interface BoardListResponse {
  items: BoardListItem[];
  offset: number;
  limit: number;
}

export interface Participant {
  userId: string;
  name: string;
  color: string;
  photoUrl?: string;
}

export interface Snapshot {
  childLinks: Record<string, Record<string, string>>;
  instances: Record<string, { type: string; variant?: string }>;
  parentLinks: Record<string, string>;
  states: Record<string, Record<string, unknown>>;
  version: number;
}

export interface WorkspaceListItem {
  id: string;
  label: string;
  type: string;
  memberCount?: number;
}

export interface WorkspaceInfo {
  id: string;
  label: string;
  type: string;
  boards?: BoardListItem[];
  folders?: { id: string; label: string; icon?: string }[];
}

export interface UserInfo {
  id: string;
  name: string;
  email?: string;
  color?: string;
  photoUrl?: string;
}

export interface TaskItem {
  id: string;
  summary: string;
  status: string;
  dueDate?: string;
  userId?: string;
  boardId?: string;
  boardLabel?: string;
  createdAt: string;
}

export interface TaskListResponse {
  items: TaskItem[];
  startAt: number;
  maxResults: number;
  total: number;
}

export interface TemplateTag {
  id: string;
  name: string;
  label: string;
  color?: string;
}

export interface TemplateItem {
  id: string;
  alias?: string;
  label: string;
  description: string;
  accountId: string | null; // non-null → account/team-owned template
  complexity?: string | null;
  people?: string | null;
  time?: string | null;
  thumbUrl?: string;
  tags?: TemplateTag[];
}

export interface CreatedBoard {
  id: string;
  podId: string;
  label: string;
  workspaceId: string;
  folderId?: string | null;
  createdAt: string;
}

// --- API functions ---

export async function listBoards(params?: {
  workspaceId?: string;
  folderId?: string;
  search?: string;
  sort?: string;
  limit?: string;
}): Promise<BoardListResponse> {
  return request<BoardListResponse>("boards.list2", {
    search: params?.search ?? "",
    sort: params?.sort ?? "lastSeenAt:desc",
    offset: "0",
    limit: params?.limit ?? "25",
    ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params?.folderId ? { folderId: params.folderId } : {}),
  });
}

export async function getBoardInfo(boardId: string): Promise<BoardInfo> {
  return request<BoardInfo>("boards.info", { boardId });
}

export async function getBoardSnapshot(podId: string): Promise<Snapshot> {
  return request<Snapshot>("pods.snapshots", { podId });
}

export async function getBoardParticipants(boardId: string): Promise<Participant[]> {
  return request<Participant[]>("boards.participants.list", { boardId });
}

export async function listWorkspaces(): Promise<WorkspaceListItem[]> {
  return request<WorkspaceListItem[]>("workspaces.list");
}

export async function getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>("workspaces.info", { workspaceId });
}

export async function getUserInfo(userId: string): Promise<UserInfo> {
  return request<UserInfo>("users.info", { userId });
}

export async function listUsers(search?: string): Promise<{ users: UserInfo[]; total: number }> {
  return request("users.list2", {
    scope: "account",
    search: search ?? "",
    offset: "0",
    count: "50",
  });
}

export async function listTasks(params: {
  workspaceId: string;
  search?: string;
  sort?: string;
}): Promise<TaskListResponse> {
  return request<TaskListResponse>("tasks.list", {
    workspaceId: params.workspaceId,
    search: params.search ?? "",
    sort: params.sort ?? "createdAt:desc",
    startAt: "0",
    maxResults: "50",
  });
}

// --- Write functions ---

/**
 * Lists board templates. The API returns the full catalogue (no server-side text
 * search), so callers filter client-side over label/description/tags.
 * @param teamOnly when true, restricts to account/team-owned templates (filter=team).
 */
export async function listTemplates(teamOnly?: boolean): Promise<TemplateItem[]> {
  return request<TemplateItem[]>("templates.list2", {
    filter: teamOnly ? "team" : "",
  });
}

/**
 * Creates a new board. `source` is "BLANK", a template id, or an existing board id.
 * Creating from a template clones its content synchronously (readable immediately via
 * getBoardSnapshot). Returns the new board's id and podId.
 */
export async function createBoard(params: {
  source: string;
  label: string;
  workspaceId: string;
  folderId?: string;
}): Promise<CreatedBoard> {
  return post<CreatedBoard>("boards.create", {
    source: params.source,
    label: params.label,
    workspaceId: params.workspaceId,
    ...(params.folderId ? { folderId: params.folderId } : {}),
  });
}
