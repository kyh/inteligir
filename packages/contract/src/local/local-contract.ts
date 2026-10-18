// both ends ship in one bundle, so this half may break freely; @repo/contract/cloud may never.

import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
  RouterContractClient,
} from "@orpc/contract";

import { agentsContract } from "./agents/agents-contract";
import { annotationsContract } from "./annotations/annotations-contract";
import { cloudContract } from "./cloud/cloud-contract";
import { connectorsContract } from "./connectors/connectors-contract";
import { foldersContract } from "./folders/folders-contract";
import { importsContract } from "./imports/imports-contract";
import { itemsContract } from "./items/items-contract";
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
  imports: importsContract,
  items: itemsContract,
  knowledge: knowledgeContract,
  system: systemContract,
  threads: threadsContract,
  vault: vaultContract,
};

export type LocalContract = typeof localContract;

// what every caller of the server types against: the page, the CLI's verbs, the browser's door and
// the e2e harness, each over its own link
export type LocalClient = RouterContractClient<LocalContract>;

export type LocalInputs = InferContractRouterInputs<LocalContract>;

export type LocalOutputs = InferContractRouterOutputs<LocalContract>;
