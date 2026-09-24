import { z } from "zod";

import { harnessIdSchema } from "@repo/agent-runtime/acp/harness-registry";
import { JsonFileStore } from "../json-file-store";

const agentPrefsSchema = z.object({ defaultHarness: harnessIdSchema.optional() }).strict();

// read per thread start, so a Settings change reaches the next action without a reboot
export class AgentPrefsStore extends JsonFileStore<typeof agentPrefsSchema> {
  constructor(dataDir: string) {
    super({ dataDir, empty: {}, fileName: "agent-prefs.json", schema: agentPrefsSchema });
  }
}
