import type { TogglMeResponse, TogglTimeEntryRaw } from "./types.js";

export class TogglApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TogglApiError";
  }
}

export interface CreateTimeEntryData {
  description: string;
  project_id?: number;
  tags?: string[];
  // Defaults to now (the normal start/continue case). Confirmed against the
  // real API: a backdated start with duration -1 is accepted just fine, so
  // this also covers restoring a deleted running entry to its original start.
  start?: string;
}

export interface CreateCompletedTimeEntryData {
  description: string;
  project_id?: number;
  tags?: string[];
  start: string;
  stop: string;
}

export interface UpdateTimeEntryData {
  description?: string;
  project_id?: number;
  tags?: string[];
  start?: string;
  stop?: string;
}

export interface TogglApiClient {
  getMe(withRelatedData: boolean): Promise<TogglMeResponse>;
  createTimeEntry(workspaceId: number, data: CreateTimeEntryData): Promise<TogglTimeEntryRaw>;
  createCompletedTimeEntry(workspaceId: number, data: CreateCompletedTimeEntryData): Promise<TogglTimeEntryRaw>;
  updateTimeEntry(workspaceId: number, entryId: number, data: UpdateTimeEntryData): Promise<TogglTimeEntryRaw>;
  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw>;
  deleteTimeEntry(workspaceId: number, entryId: number): Promise<void>;
}

export class TogglClient implements TogglApiClient {
  constructor(
    private token: string,
    private baseUrl = "https://api.track.toggl.com/api/v9"
  ) {}

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.token}:api_token`).toString("base64");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new TogglApiError("Invalid or expired API token", 401);
    if (res.status === 429) throw new TogglApiError("Rate limited by Toggl", 429);
    if (!res.ok) throw new TogglApiError(`Toggl API error: ${res.status}`, res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getMe(withRelatedData: boolean): Promise<TogglMeResponse> {
    return this.request("GET", `/me${withRelatedData ? "?with_related_data=true" : ""}`);
  }

  createTimeEntry(workspaceId: number, data: CreateTimeEntryData): Promise<TogglTimeEntryRaw> {
    return this.request("POST", `/workspaces/${workspaceId}/time_entries`, {
      ...data,
      workspace_id: workspaceId,
      start: data.start ?? new Date().toISOString(),
      duration: -1,
      created_with: "togglr",
    });
  }

  createCompletedTimeEntry(
    workspaceId: number,
    data: CreateCompletedTimeEntryData
  ): Promise<TogglTimeEntryRaw> {
    const durationSeconds = Math.round(
      (new Date(data.stop).getTime() - new Date(data.start).getTime()) / 1000
    );
    return this.request("POST", `/workspaces/${workspaceId}/time_entries`, {
      description: data.description,
      project_id: data.project_id,
      tags: data.tags,
      workspace_id: workspaceId,
      start: data.start,
      stop: data.stop,
      duration: durationSeconds,
      created_with: "togglr",
    });
  }

  updateTimeEntry(
    workspaceId: number,
    entryId: number,
    data: UpdateTimeEntryData
  ): Promise<TogglTimeEntryRaw> {
    // Confirmed against the real API: PUT here is a genuine partial update —
    // omitted fields keep their existing server-side value, unlike a typical
    // REST "PUT replaces the whole resource" contract.
    const body: Record<string, unknown> = {};
    if (data.description !== undefined) body.description = data.description;
    if (data.project_id !== undefined) body.project_id = data.project_id;
    if (data.tags !== undefined) body.tags = data.tags;
    // start/stop are sent independently (e.g. nudging just the start of a
    // still-running entry, which has no stop) — duration is only recomputed
    // when both are given together, since it'd otherwise be nonsensical.
    if (data.start !== undefined) body.start = data.start;
    if (data.stop !== undefined) body.stop = data.stop;
    if (data.start !== undefined && data.stop !== undefined) {
      body.duration = Math.round((new Date(data.stop).getTime() - new Date(data.start).getTime()) / 1000);
    }
    return this.request("PUT", `/workspaces/${workspaceId}/time_entries/${entryId}`, body);
  }

  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw> {
    return this.request("PATCH", `/workspaces/${workspaceId}/time_entries/${entryId}/stop`);
  }

  async deleteTimeEntry(workspaceId: number, entryId: number): Promise<void> {
    // Toggl returns 200 with an EMPTY body for DELETE (confirmed against the
    // real API) — can't reuse request<T>()'s unconditional res.json() here.
    const res = await fetch(`${this.baseUrl}/workspaces/${workspaceId}/time_entries/${entryId}`, {
      method: "DELETE",
      headers: { Authorization: this.authHeader() },
    });
    if (res.status === 401) throw new TogglApiError("Invalid or expired API token", 401);
    if (res.status === 429) throw new TogglApiError("Rate limited by Toggl", 429);
    if (!res.ok) throw new TogglApiError(`Toggl API error: ${res.status}`, res.status);
  }
}
