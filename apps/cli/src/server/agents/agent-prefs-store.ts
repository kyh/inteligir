// not config.json: that is read once at boot and never written by the app; this is read per
// thread start, so a Settings change reaches the next action without a reboot.
// malformed bytes are an error, not an empty choice — the next write would erase them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { isHarnessId } from "@repo/agent-runtime/acp/harness-registry";
import { stagedWriteFileSync } from "../staged-write";

const AGENT_PREFS_FILE = "agent-prefs.json";

const harnessIdSchema = z.string().transform((value, ctx) => {
  if (!isHarnessId(value)) {
    ctx.addIssue({ code: "custom", message: `${value} is not a harness` });
    return z.NEVER;
  }
  return value;
});

const storeFileSchema = z.object({ defaultHarness: harnessIdSchema.optional() }).strict();

export type AgentPrefs = z.infer<typeof storeFileSchema>;

export class AgentPrefsStoreError extends Error {}

export class AgentPrefsStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, AGENT_PREFS_FILE);
  }

  read(): AgentPrefs {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AgentPrefsStoreError(
        `${this.path} is not valid JSON — fix or remove the file; refusing to read it as empty`,
      );
    }
    const verdict = storeFileSchema.safeParse(parsed);
    if (!verdict.success) {
      throw new AgentPrefsStoreError(
        `${this.path} does not match the agent-prefs shape — fix or remove the file`,
      );
    }
    return verdict.data;
  }

  write(prefs: AgentPrefs): void {
    stagedWriteFileSync(this.path, `${JSON.stringify(prefs, null, 2)}\n`);
  }
}
