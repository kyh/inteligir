// both ends ship in one bundle, so this half may break freely; @repo/contract/cloud may never.

import { agentsContract } from "./agents/agents-contract";
import { annotationsContract } from "./annotations/annotations-contract";
import { cloudContract } from "./cloud/cloud-contract";
import { connectorsContract } from "./connectors/connectors-contract";
import { foldersContract } from "./folders/folders-contract";
import { knowledgeContract } from "./knowledge/knowledge-contract";
import { systemContract } from "./system/system-contract";
import { threadsContract } from "./threads/threads-contract";
import { vaultContract } from "./vault/vault-contract";

export const localContract = {
  agents: agentsContract,
  annotations: annotationsContract,
  cloud: cloudContract,
  connectors: connectorsContract,
  folders: foldersContract,
  knowledge: knowledgeContract,
  system: systemContract,
  threads: threadsContract,
  vault: vaultContract,
};

export type LocalContract = typeof localContract;
