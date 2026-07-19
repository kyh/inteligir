import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentLogWriter, type AgentLogWriter } from "../agent-log";

let dir: string;
let writer: AgentLogWriter;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-log-"));
  writer = createAgentLogWriter({ dir });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readLog(): string {
  return fs.readFileSync(writer.logPath, "utf8");
}

describe("prefix mirroring", () => {
  it("mirrors [tag]-prefixed info lines", () => {
    writer.append("info", ["[machine] logged_out -> logged_in"]);
    writer.append("info", ["[some-new-tag] hello"]);
    const log = readLog();
    expect(log).toContain("INFO  [machine] logged_out -> logged_in");
    expect(log).toContain("INFO  [some-new-tag] hello");
  });

  it("skips untagged info lines", () => {
    writer.append("info", ["framework noise without a tag"]);
    writer.append("info", ["[machine] kept"]);
    const log = readLog();
    expect(log).not.toContain("framework noise");
    expect(log).toContain("[machine] kept");
  });

  it("mirrors every warn/error line, tagged or not", () => {
    writer.append("warn", ["untagged warning"]);
    writer.append("error", ["untagged failure"]);
    writer.append("error", ["[agent] tagged failure"]);
    const log = readLog();
    expect(log).toContain("WARN  untagged warning");
    expect(log).toContain("ERROR untagged failure");
    expect(log).toContain("ERROR [agent] tagged failure");
  });

  it("skips info lines whose first arg is not a string", () => {
    writer.append("info", [{ structured: true }]);
    expect(fs.existsSync(writer.logPath)).toBe(false);
  });

  it("formats Error args with their stack and objects as JSON", () => {
    const err = new Error("boom");
    writer.append("error", ["[agent] failed:", err, { code: 7 }]);
    const log = readLog();
    expect(log).toContain("Error: boom");
    expect(log).toContain('{"code":7}');
  });
});

describe("message_update skipping", () => {
  it("never writes per-token message_update lines, at any level", () => {
    writer.append("info", ["[agent-event] message_update +12ms"]);
    writer.append("warn", ["[agent-event] message_update +13ms"]);
    writer.append("error", ["[agent-event] message_update +14ms"]);
    expect(fs.existsSync(writer.logPath)).toBe(false);
  });

  it("still mirrors other [agent-event] lines", () => {
    writer.append("info", ["[agent-event] message_end role=assistant stop=stop len=4 +90ms"]);
    expect(readLog()).toContain("message_end");
  });
});

describe("rotation", () => {
  it("rotates to agent.log.1 when the cap would be exceeded", () => {
    const small = createAgentLogWriter({ dir, maxBytes: 200 });
    const line = `[agent] ${"x".repeat(80)}`;
    small.append("info", [line]); // ~120 bytes
    small.append("info", [line]); // would push past 200 → rotates first
    const rotated = fs.readFileSync(`${small.logPath}.1`, "utf8");
    const live = fs.readFileSync(small.logPath, "utf8");
    expect(rotated.match(/\n/g)).toHaveLength(1);
    expect(live.match(/\n/g)).toHaveLength(1);
  });

  it("keeps exactly one rotated file across repeated rotations", () => {
    const small = createAgentLogWriter({ dir, maxBytes: 100 });
    for (let i = 0; i < 6; i += 1) {
      small.append("info", [`[agent] line ${i} ${"y".repeat(70)}`]);
    }
    const files = fs.readdirSync(dir).toSorted();
    expect(files).toEqual(["agent.log", "agent.log.1"]);
  });

  it("does not rotate below the cap", () => {
    writer.append("info", ["[agent] one"]);
    writer.append("info", ["[agent] two"]);
    expect(fs.existsSync(`${writer.logPath}.1`)).toBe(false);
  });
});

describe("logout-wipe survival", () => {
  it("recreates the log dir and file after the directory is removed", () => {
    writer.append("info", ["[agent] before wipe"]);
    fs.rmSync(dir, { recursive: true, force: true });
    writer.append("info", ["[agent] after wipe"]);
    const log = readLog();
    expect(log).toContain("after wipe");
    expect(log).not.toContain("before wipe");
  });

  it("writeRaw also survives a wipe (session markers)", () => {
    writer.writeRaw("--- session start ---");
    fs.rmSync(dir, { recursive: true, force: true });
    writer.writeRaw("--- session start again ---");
    expect(readLog()).toContain("session start again");
  });
});
