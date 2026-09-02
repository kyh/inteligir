// The implementer, and the context every handler reaches its services through.
//
// SERVICES ARRIVE IN THE CONTEXT, not in a closure: one typed context says
// what a handler may reach, in one place, instead of each handler's
// dependencies being visible only at the call site that wired it.
//
// THERE IS NO PROCEDURE LADDER, and that is deliberate rather than an
// omission. The two things a ladder would guard are already guarded, each by
// exactly one owner: the DEVICE TOKEN is checked at the HTTP boundary, because
// three of the four surfaces it protects are not procedures at all
// (`server-file.ts` states the argument); and VAULT CONTAINMENT is physical
// and belongs to the vault service, which is the only way a handler can reach
// a file — realpath the deepest existing ancestor, refuse a symlinked leaf. A
// `resolveVaultPath` middleware would be a SECOND answer to containment, and
// two answers to one question is how a traversal reaches the second gate
// believing it passed the first.
//
// @see https://orpc.dev/docs/contract-first/implement-contract

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
import type { NoteIntelligence } from "./note-intelligence/note-intelligence";
import type { ThreadService } from "./threads/service";
import type { VaultRuntime } from "./vault/vault-runtime";
import type { RenameNote } from "./vault/vault-router";
import type { VoiceService } from "./voice/voice-service";

/** What `/system/status` answers, resolved once at boot rather than per call. */
interface SystemFacts {
  version: string;
  dataDir: string;
  vaultDir: string;
  /** The `meta.schema_version` row — proves migrate-on-boot ran. */
  schemaVersion: number;
  startedAt: number;
  agent: AgentStatus;
}

/** Every service a handler may reach, and nothing else. */
export interface AppContext {
  cloud: CloudRuntime;
  comments: CommentsService;
  connectors: ConnectorsService;
  connectorsOauth: ConnectorOauthFlow;
  folders: FoldersService;
  knowledge: KnowledgeRuntime;
  noteIntelligence: NoteIntelligence;
  /** Opens a URL in the user's browser — injected so a suite can watch a
   *  pairing begin without a window opening on whoever ran it. */
  openExternalUrl: OpenExternalUrl;
  /**
   * THIS request's Host header, the one per-request value in the context.
   *
   * Two procedures compose a loopback callback URL for a browser to come back
   * to (`cloud.pairBegin`, `connectors.oauthBegin`), and the port that URL must
   * name is the one the CALLER actually reached — `listen` may have probed past
   * a busy dev port, so the configured value would send the browser somewhere
   * nothing is listening. `loopback-origin.ts` is the one reading of it.
   */
  requestHost: string | undefined;
  /** The composed rename (the link rewrite riding the vault service's own),
   *  which no single service owns. */
  renameNote: RenameNote;
  system: SystemFacts;
  threads: ThreadService;
  vault: VaultRuntime;
  voice: VoiceService;
}

/** Everything a handler reaches — the context minus the one per-request
 *  value, which only a live request can supply. What the composition root
 *  builds and the route wiring is handed. */
export type AppServices = Omit<AppContext, "requestHost">;

/** The base implementer. Every domain router builds on it; `root-router.ts`
 *  is where the composition is checked. */
export const base = implement(localContract).$context<AppContext>();

/**
 * ONE wrapper, per-domain table. `translate` is the domain's own answer to
 * "what does the wire call this?"; this is only the try/catch around it, which
 * every router had its own byte-identical copy of.
 *
 * A refusal the table has no name for is rethrown as it came — a 500, and it
 * should be: the alternative is inventing a class the contract row does not
 * declare and the client cannot narrow on.
 */
export function refusals(translate: (cause: unknown) => ORPCError<string, unknown> | null) {
  return async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (cause) {
      throw translate(cause) ?? cause;
    }
  };
}
