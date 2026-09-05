import { z } from "zod";

import { isHarnessId } from "@repo/agent-runtime/acp/harness-registry";
import { JsonFileStore } from "../json-file-store";

const harnessIdSchema = z.string().transform((value, ctx) => {
  if (!isHarnessId(value)) {
    ctx.addIssue({ code: "custom", message: `${value} is not a harness` });
    return z.NEVER;
  }
  return value;
});

const agentPrefsSchema = z.object({ defaultHarness: harnessIdSchema.optional() }).strict();

// read per thread start, so a Settings change reaches the next action without a reboot
export class AgentPrefsStore extends JsonFileStore<typeof agentPrefsSchema> {
  constructor(dataDir: string) {
    super({ dataDir, fileName: "agent-prefs.json", schema: agentPrefsSchema, empty: {} });
  }
}
