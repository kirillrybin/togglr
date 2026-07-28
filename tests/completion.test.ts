import { describe, expect, it } from "vitest";
import { getCompletionScript, BASH_COMPLETION, ZSH_COMPLETION } from "../src/completion.js";

const EXPECTED_COMMANDS = [
  "start",
  "add",
  "edit",
  "stop",
  "status",
  "list-projects",
  "continue",
  "report",
  "config",
  "completion",
];

describe("getCompletionScript", () => {
  it("returns the bash script for \"bash\"", () => {
    expect(getCompletionScript("bash")).toBe(BASH_COMPLETION);
  });

  it("returns the zsh script for \"zsh\"", () => {
    expect(getCompletionScript("zsh")).toBe(ZSH_COMPLETION);
  });

  it("returns null for an unsupported shell", () => {
    expect(getCompletionScript("fish")).toBeNull();
  });
});

describe("BASH_COMPLETION", () => {
  it("registers completion for both the toggl and togglr binaries", () => {
    expect(BASH_COMPLETION).toContain("complete -F _toggl_completions toggl togglr");
  });

  it("lists every top-level command", () => {
    for (const cmd of EXPECTED_COMMANDS) {
      expect(BASH_COMPLETION).toContain(cmd);
    }
  });
});

describe("ZSH_COMPLETION", () => {
  it("declares itself for both the toggl and togglr binaries", () => {
    expect(ZSH_COMPLETION.startsWith("#compdef toggl togglr")).toBe(true);
  });

  it("lists every top-level command", () => {
    for (const cmd of EXPECTED_COMMANDS) {
      expect(ZSH_COMPLETION).toContain(cmd);
    }
  });

  it("explicitly registers via compdef instead of relying on the inert #compdef header", () => {
    // The #compdef header only works when zsh's compinit loads this file off
    // fpath — under `eval "$(toggl completion zsh)"` it's a no-op comment, so
    // an explicit `compdef _toggl toggl togglr` call is what actually wires
    // completion up. Regression test for a real bug: the script used to just
    // call `_toggl` directly, which runs the completion function once as a
    // no-op instead of registering it.
    expect(ZSH_COMPLETION).toContain("compdef _toggl toggl togglr");
    expect(ZSH_COMPLETION).not.toMatch(/\n_toggl\n\s*$/);
  });

  it("loads compinit first if it hasn't already run", () => {
    expect(ZSH_COMPLETION).toContain("autoload -Uz compinit");
  });
});
