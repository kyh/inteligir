// The implementer, and the context every handler reaches its services through.
//
// SERVICES ARRIVE IN THE CONTEXT, not in a closure. `createApp` used to pass
// each service positionally into a `register*` call, which made the wiring a
// twelve-argument fan-out and made a handler's dependencies invisible from the
// handler. One typed context says what a handler may reach, in one place.
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
import { implement } from "@orpc/server";
import type { CommentsService } from "./comments/comments-service";
import type { CloudRuntime } from "./cloud/sync-runtime";
import type { ConnectorsService } from "./connectors/connectors-service";
import type { ConnectorOauthFlow } from "./connectors/oauth-flow";
import type { OpenExternalUrl } from "./cloud/browser-opener";
import type { FoldersService } from "./folders/folders-service";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import type { NoteIntelligence } from "./note-intelligence/note-intelligence";
import type { ProposalService } from "./proposals/proposal-service";
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
  proposals: ProposalService;
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

/**
 * The base implementer. Every domain router builds on it, and
 * `base.router({...})` at the root is the type-check point: a procedure that
 * drifts from the contract — or one nobody implemented — fails to compile.
 * That is what replaces the vendored route table, and the completeness guard
 * that had to be a test beside it.
 */
export const base = implement(localContract).$context<AppContext>();
