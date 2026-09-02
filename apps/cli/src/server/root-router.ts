// base.router is the completeness check: a handler drifting from its contract
// row, or a procedure nobody implemented, fails to compile here.

import { agentsRouter } from "./agents/agents-router";
import { cloudRouter } from "./cloud/cloud-router";
import { commentsRouter } from "./comments/comments-router";
import { connectorsRouter } from "./connectors/connectors-router";
import { foldersRouter } from "./folders/folders-router";
import { knowledgeRouter } from "./knowledge/knowledge-router";
import { noteIntelligenceRouter } from "./note-intelligence/note-intelligence-router";
import { base } from "./orpc";
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
  system: systemRouter,
  threads: threadsRouter,
  vault: vaultRouter,
  voice: voiceRouter,
});
