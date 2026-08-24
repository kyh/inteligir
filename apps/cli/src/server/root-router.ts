// THE composed router, and the completeness check. `base.router({...})` is the
// type-check point: a handler that drifts from its contract row — or a
// procedure nobody implemented — fails to compile HERE, so the contract's
// coverage needs no test beside it.

import { agentsRouter } from "./agent/agents-router";
import { cloudRouter } from "./cloud/cloud-router";
import { commentsRouter } from "./comments/comments-router";
import { connectorsRouter } from "./connectors/connectors-router";
import { foldersRouter } from "./folders/folders-router";
import { knowledgeRouter } from "./knowledge/knowledge-router";
import { noteIntelligenceRouter } from "./note-intelligence/note-intelligence-router";
import { base } from "./orpc";
import { proposalsRouter } from "./proposals/proposals-router";
import { systemRouter } from "./system/system-router";
import { threadsRouter } from "./threads/threads-router";
import { vaultRouter } from "./vault/vault-router";
import { voiceRouter } from "./voice/voice-router";

export const localRouter = base.router({
  agents: agentsRouter,
  cloud: cloudRouter,
  comments: commentsRouter,
  connectors: connectorsRouter,
  folders: foldersRouter,
  knowledge: knowledgeRouter,
  noteIntelligence: noteIntelligenceRouter,
  proposals: proposalsRouter,
  system: systemRouter,
  threads: threadsRouter,
  vault: vaultRouter,
  voice: voiceRouter,
});
