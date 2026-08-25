// THE local contract: one entry per domain, and the type both ends compile
// against.
//
// Its two ends ship inside one bundle and always match, so this half may break
// freely — which is exactly what `@repo/api/cloud` may never do, and why the
// two are separate routers in one package. That distinction is the most
// valuable thing this package encodes; keep it visible.
//
// What is NOT here is `local-routes.ts`: /health, /vault/asset, /ws and
// /voice/stream answer bytes, sockets and a supervisor's probe, none of which
// is a procedure.

import { agentsContract } from "./agents/agents-contract";
import { cloudContract } from "./cloud/cloud-contract";
import { commentsContract } from "./comments/comments-contract";
import { connectorsContract } from "./connectors/connectors-contract";
import { foldersContract } from "./folders/folders-contract";
import { knowledgeContract } from "./knowledge/knowledge-contract";
import { noteIntelligenceContract } from "./note-intelligence/note-intelligence-contract";
import { proposalsContract } from "./proposals/proposals-contract";
import { systemContract } from "./system/system-contract";
import { threadsContract } from "./threads/threads-contract";
import { vaultContract } from "./vault/vault-contract";
import { voiceContract } from "./voice/voice-contract";

export const localContract = {
  agents: agentsContract,
  cloud: cloudContract,
  comments: commentsContract,
  connectors: connectorsContract,
  folders: foldersContract,
  knowledge: knowledgeContract,
  noteIntelligence: noteIntelligenceContract,
  proposals: proposalsContract,
  system: systemContract,
  threads: threadsContract,
  vault: vaultContract,
  voice: voiceContract,
};

export type LocalContract = typeof localContract;
