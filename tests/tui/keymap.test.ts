import { describe, expect, it } from "vitest";
import { normalizeKey } from "../../src/tui/keymap.js";

describe("normalizeKey", () => {
  it("maps Cyrillic (ЙЦУКЕН) characters to the Latin key at the same physical position", () => {
    expect(normalizeKey("ы")).toBe("s"); // stop
    expect(normalizeKey("с")).toBe("c"); // continue
    expect(normalizeKey("т")).toBe("n"); // new
    expect(normalizeKey("в")).toBe("d"); // delete
    expect(normalizeKey("к")).toBe("r"); // refresh
    expect(normalizeKey("й")).toBe("q"); // quit
    expect(normalizeKey("н")).toBe("y"); // confirm yes
    expect(normalizeKey("о")).toBe("j"); // move down
    expect(normalizeKey("л")).toBe("k"); // move up
  });

  it("leaves Latin keys and unmapped characters unchanged", () => {
    expect(normalizeKey("s")).toBe("s");
    expect(normalizeKey("n")).toBe("n");
    expect(normalizeKey("x")).toBe("x");
    expect(normalizeKey("")).toBe("");
  });
});
