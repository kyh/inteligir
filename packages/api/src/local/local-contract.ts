// both ends ship in one bundle, so this half may break freely; @repo/api/cloud may never.

import { agentsContract } from "./agents/agents-contract";
import { cloudContract } from "./cloud/cloud-contract";
import { commentsContract } from "./comments/comments-contract";
import { connectorsContract } from "./connectors/connectors-contract";
import { foldersContract } from "./folders/folders-contract";
import { knowledgeContract } from "./knowledge/knowledge-contract";
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
  system: systemContract,
  threads: threadsContract,
  vault: vaultContract,
  voice: voiceContract,
};

export type LocalContract = typeof localContract;
