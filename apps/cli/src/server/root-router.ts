// base.router is the completeness check: a handler drifting from its contract
// row, or a procedure nobody implemented, fails to compile here.

import { agentsRouter } from "./agents/agents-router";
import { annotationsRouter } from "./annotations/annotations-router";
import { cloudRouter } from "./cloud/cloud-router";
import { connectorsRouter } from "./connectors/connectors-router";
import { foldersRouter } from "./folders/folders-router";
import { knowledgeRouter } from "./knowledge/knowledge-router";
import { base } from "./orpc";
import { systemRouter } from "./system/system-router";
import { threadsRouter } from "./threads/threads-router";
import { vaultRouter } from "./vault/vault-router";

export const localRouter = base.router({
  agents: agentsRouter,
  annotations: annotationsRouter,
  cloud: cloudRouter,
  connectors: connectorsRouter,
  folders: foldersRouter,
  knowledge: knowledgeRouter,
  system: systemRouter,
  threads: threadsRouter,
  vault: vaultRouter,
});
