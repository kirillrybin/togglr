import { describe, expect, it, vi, beforeEach } from "vitest";
import { TogglClient, TogglApiError } from "../../src/api/client.js";

describe("TogglClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("sends Basic auth header built from the API token", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, default_workspace_id: 42 }),
    });
    const client = new TogglClient("mytoken");
    await client.getMe(false);
    const [, init] = (fetch as any).mock.calls[0];
    const expected = "Basic " + Buffer.from("mytoken:api_token").toString("base64");
    expect(init.headers.Authorization).toBe(expected);
  });

  it("appends with_related_data=true when requested", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("mytoken");
    await client.getMe(true);
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toContain("with_related_data=true");
  });

  it("throws TogglApiError with status 401 on invalid token", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const client = new TogglClient("bad");
    await expect(client.getMe(false)).rejects.toMatchObject({ status: 401 });
    await expect(client.getMe(false)).rejects.toBeInstanceOf(TogglApiError);
  });

  it("throws TogglApiError with status 429 when rate limited", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const client = new TogglClient("t");
    await expect(client.getMe(false)).rejects.toMatchObject({ status: 429 });
  });

  it("sends POST request to correct URL with proper body for createTimeEntry", async () => {
    const mockResponse = { id: 123, description: "Test task", duration: -1 };
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => mockResponse });
    const client = new TogglClient("token");
    const data = { description: "Test task", project_id: 42, tags: ["work"] };
    const result = await client.createTimeEntry(999, data);

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/workspaces/999/time_entries");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.description).toBe("Test task");
    expect(body.project_id).toBe(42);
    expect(body.tags).toEqual(["work"]);
    expect(body.workspace_id).toBe(999);
    expect(body.duration).toBe(-1);
    expect(body.created_with).toBe("togglr");
    expect(body.start).toBeTruthy();
    expect(typeof body.start).toBe("string");

    expect(result).toEqual(mockResponse);
  });

  it("uses a given start for createTimeEntry instead of defaulting to now (restoring a deleted running entry)", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("token");

    await client.createTimeEntry(999, { description: "Restored", start: "2026-07-26T08:00:00.000Z" });

    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.start).toBe("2026-07-26T08:00:00.000Z");
    expect(body.duration).toBe(-1);
  });

  it("sends POST request with explicit start/stop/duration for createCompletedTimeEntry", async () => {
    const mockResponse = { id: 124, description: "Manual entry", duration: 9000 };
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => mockResponse });
    const client = new TogglClient("token");
    const data = {
      description: "Manual entry",
      project_id: 42,
      tags: ["work"],
      start: "2026-07-26T09:00:00.000Z",
      stop: "2026-07-26T11:30:00.000Z",
    };
    const result = await client.createCompletedTimeEntry(999, data);

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/workspaces/999/time_entries");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.description).toBe("Manual entry");
    expect(body.project_id).toBe(42);
    expect(body.tags).toEqual(["work"]);
    expect(body.workspace_id).toBe(999);
    expect(body.start).toBe("2026-07-26T09:00:00.000Z");
    expect(body.stop).toBe("2026-07-26T11:30:00.000Z");
    expect(body.duration).toBe(9000); // 2h30m in seconds, computed from start/stop
    expect(body.created_with).toBe("togglr");

    expect(result).toEqual(mockResponse);
  });

  it("sends PUT request to correct URL for updateTimeEntry with only the given fields", async () => {
    const mockResponse = { id: 5, description: "Renamed", duration: 900 };
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => mockResponse });
    const client = new TogglClient("token");

    const result = await client.updateTimeEntry(999, 5, { description: "Renamed" });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/workspaces/999/time_entries/5");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ description: "Renamed" }); // project_id/tags/start/stop omitted entirely
    expect(result).toEqual(mockResponse);
  });

  it("computes duration and includes start/stop together for updateTimeEntry when both are given", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("token");

    await client.updateTimeEntry(999, 5, {
      start: "2026-07-26T09:00:00.000Z",
      stop: "2026-07-26T09:15:00.000Z",
    });

    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.start).toBe("2026-07-26T09:00:00.000Z");
    expect(body.stop).toBe("2026-07-26T09:15:00.000Z");
    expect(body.duration).toBe(900);
  });

  it("sends start on its own when stop isn't given (e.g. nudging a running entry's start)", async () => {
    // Regression test: this used to require BOTH start and stop before
    // sending EITHER, so editing just the start of a running entry (which
    // has no stop) silently sent a body without `start` at all — the API
    // call "succeeded" but never actually moved the entry's start time.
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("token");

    await client.updateTimeEntry(999, 5, { start: "2026-07-26T09:00:00.000Z" });

    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.start).toBe("2026-07-26T09:00:00.000Z");
    expect(body.stop).toBeUndefined();
    expect(body.duration).toBeUndefined();
  });

  it("sends stop on its own when start isn't given", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TogglClient("token");

    await client.updateTimeEntry(999, 5, { stop: "2026-07-26T09:15:00.000Z" });

    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.stop).toBe("2026-07-26T09:15:00.000Z");
    expect(body.start).toBeUndefined();
    expect(body.duration).toBeUndefined();
  });

  it("sends DELETE request to correct URL for deleteTimeEntry and handles an empty 200 body", async () => {
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("no body to parse"); } });
    const client = new TogglClient("token");

    await expect(client.deleteTimeEntry(999, 123)).resolves.toBeUndefined();

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/workspaces/999/time_entries/123");
    expect(init.method).toBe("DELETE");
  });

  it("throws TogglApiError with status 404 when deleting an entry that no longer exists", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const client = new TogglClient("token");
    await expect(client.deleteTimeEntry(999, 123)).rejects.toMatchObject({ status: 404 });
  });

  it("sends PATCH request to correct URL for stopTimeEntry", async () => {
    const mockResponse = { id: 123, description: "Test task", duration: 300, stop: "2026-07-26T11:00:00Z" };
    (fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => mockResponse });
    const client = new TogglClient("token");
    const result = await client.stopTimeEntry(999, 123);

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("/workspaces/999/time_entries/123/stop");
    expect(init.method).toBe("PATCH");

    expect(result).toEqual(mockResponse);
  });
});
