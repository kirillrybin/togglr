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
}

export interface TogglApiClient {
  getMe(withRelatedData: boolean): Promise<TogglMeResponse>;
  createTimeEntry(workspaceId: number, data: CreateTimeEntryData): Promise<TogglTimeEntryRaw>;
  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw>;
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
      start: new Date().toISOString(),
      duration: -1,
      created_with: "togglr",
    });
  }

  stopTimeEntry(workspaceId: number, entryId: number): Promise<TogglTimeEntryRaw> {
    return this.request("PATCH", `/workspaces/${workspaceId}/time_entries/${entryId}/stop`);
  }
}
