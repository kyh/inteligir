// no middleware ladder: the token is checked at the http boundary (three of the
// four surfaces it guards are not procedures) and containment is the vault
// service's alone — a resolveVaultPath middleware would be a second answer to it.

import { localContract } from "@repo/api/local";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { implement, ORPCError } from "@orpc/server";
import type { CommentsService } from "./comments/comments-service";
import type { CloudRuntime } from "./cloud/sync-runtime";
import type { ConnectorsService } from "./connectors/connectors-service";
import type { ConnectorOauthFlow } from "./connectors/oauth-flow";
import type { OpenExternalUrl } from "./cloud/browser-opener";
import type { FoldersService } from "./folders/folders-service";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { ThreadService } from "./threads/service";
import type { VaultRuntime } from "./vault/vault-runtime";
import type { RenameNote } from "./vault/vault-router";
import type { VoiceService } from "./voice/voice-service";

interface SystemFacts {
  version: string;
  dataDir: string;
  vaultDir: string;
  schemaVersion: number;
  startedAt: number;
  agent: AgentStatus;
}

export interface AppContext {
  cloud: CloudRuntime;
  comments: CommentsService;
  connectors: ConnectorsService;
  connectorsOauth: ConnectorOauthFlow;
  folders: FoldersService;
  knowledge: KnowledgeRuntime;
  // injected so a suite can watch an authorization begin without opening a window.
  openExternalUrl: OpenExternalUrl;
  // the one per-request value: a callback url must name the port the caller
  // reached, since listen may have probed past the configured one.
  requestHost: string | undefined;
  renameNote: RenameNote;
  system: SystemFacts;
  threads: ThreadService;
  vault: VaultRuntime;
  voice: VoiceService;
}

export type AppServices = Omit<AppContext, "requestHost">;

export const base = implement(localContract).$context<AppContext>();

// an unnamed refusal is rethrown as it came — a 500, rather than a class the contract row does not declare.
export function refusals(translate: (cause: unknown) => ORPCError<string, unknown> | null) {
  return async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (cause) {
      throw translate(cause) ?? cause;
    }
  };
}
