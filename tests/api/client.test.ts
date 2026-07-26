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
});
