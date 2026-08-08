// ---------------------------------------------------------------------------
// The sandbox port — everything the Durable Object may ask of the container,
// and everything the container may say back.
//
// TWO DIRECTIONS, AND BOTH ARE THE PORT'S. Outbound is the six verbs below.
// Inbound is `SandboxReportSink`: one entry, bearer first, body as text. That
// is not symmetry for its own sake — it is what makes a TURN one testable
// thing. A port that only covered the outbound half left the return path to be
// reached two unrelated ways, and the LANE (whose undo surface owns a vault
// write) derived twice with it. Now the sink resolves the lane from the
// bearer's own boot, once, whichever transport carried the report.
//
// It is deliberately NOT a mirror of `@cloudflare/sandbox`. That surface is
// dozens of methods (sessions, processes, git, interpreter, tunnels, backups)
// and binding one to it would put the SDK's shape in the middle of the agent's
// logic, where nothing could be tested without a Workers Paid plan and a built
// image. This is what the agent actually needs, and it is what an in-memory
// fake can implement COMPLETELY (./fake-sandbox) — so the tests drive the same
// runner, tool executor and transcript the real binding drives, and the only
// difference between the two is which container ran.
//
// EVERY METHOD ANSWERS WITH A VALUE. A container that will not start is a
// sentence in the user's chat, not a 500 on a Bridge call — and the failure
// modes here are ordinary (the plan does not cover containers, the image is
// stale, the platform is busy), so a throw would be the wrong shape even before
// it reached a socket. Both adapters answer the same conditions with the SAME
// sentence, which is why the refusals live in the container's contract
// (`CONTAINER_REFUSAL`) rather than in either implementation. `state` is the
// one that must never fail at all: it is how the runner learns the container
// was wiped.
//
// THE CONTAINER FILESYSTEM IS EPHEMERAL. On sleep or restart every file is
// deleted and every process terminates; only the Sandbox's Durable Object
// identity survives. So `boot` and `materialize` are not first-run steps — they
// are what a WAKE looks like, and the port's job is to make that legible rather
// than to hide it. `SandboxState` is the whole reason: the container reports
// what it currently holds, because the DO cannot know.
// ---------------------------------------------------------------------------

import type { TSchema } from "@sinclair/typebox";

import type { AgentReportReply } from "@repo/agent-container/protocol";

/** Every port method's verdict. */
export type SandboxOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * What the container says it is holding right now.
 *
 * `cold` covers unreachable and never-booted together on purpose: the recovery
 * is identical (boot it, materialize the vault), and a port that distinguished
 * them would invite a caller to treat one as an error worth surfacing.
 */
export type SandboxState =
  | { readonly phase: "cold" }
  | {
      readonly phase: "ready";
      /** The boot the DO minted for the session this container is running. A
       * value the DO does not recognize means the container restarted under it. */
      readonly bootId: string;
      /** The vault revision the container's `./vault` was last materialized at. */
      readonly vaultRevision: number;
      /**
       * Whether the live session already holds the conversation.
       *
       * A BOOLEAN, because that is the whole question the runner asks it: seed
       * this turn, or don't. A transcript position would be a number this side
       * could only ever compare against zero — an interface lying about its
       * type — and the container is the one that knows, since a session that
       * refused the prompt its seed rode in with never took the conversation.
       */
      readonly seeded: boolean;
      /** A turn is in flight. */
      readonly busy: boolean;
    };

/** One file the container must hold under `./vault`. */
export type SandboxVaultFile = { readonly path: string; readonly bytes: Uint8Array };

/**
 * A vault push. `replaceAll` is the wake case — the container holds nothing, so
 * the DO sends the whole manifest and the container drops anything else under
 * `./vault` first. Otherwise this is the delta since `fromRevision`.
 */
export type SandboxVaultPush = {
  readonly toRevision: number;
  readonly replaceAll: boolean;
  readonly upserted: readonly SandboxVaultFile[];
  readonly removed: readonly string[];
};

/**
 * One granted tool as the container registers it.
 *
 * The `description` and the parameter schema both originate in the grant table
 * (./agent-tools), and the container is handed them rather than holding a copy:
 * a container image that shipped its own tool list could grant a capability the
 * table never declared, which is exactly the drift the table exists to prevent.
 */
export type SandboxToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly parameters: TSchema;
};

/**
 * The provider the turn runs on, as the container sees it.
 *
 * `apiKey` is a PLACEHOLDER, never a credential (./egress). pi requires a
 * non-empty key to pass its own prompt gate, and the sandbox's outbound
 * interception replaces the Authorization header on the way out — so the value
 * here authenticates nothing and is safe on a container filesystem.
 */
type SandboxProvider = {
  readonly provider: string;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
};

/** One prior turn, replayed into a fresh pi session as context. */
export type SandboxSeedTurn = {
  readonly role: "user" | "assistant";
  readonly text: string;
};

/**
 * Cloudflare Browser Run, for the `browser` tool.
 *
 * The credential rides INTO the container rather than through the outbound
 * interceptor, and that is a real asymmetry with the provider credential
 * (./egress) rather than an oversight: the CDP endpoint is reached over a
 * `wss://` upgrade, and the interceptor covers HTTP and HTTPS. `null` when the
 * deployment configured no Browser Run account, in which case the tool is not
 * registered at all — a dead tool in the model's menu is worse than none.
 */
type SandboxBrowser = { readonly cdpUrl: string; readonly token: string };

export type SandboxBoot = {
  /** The boot identity the container echoes back from `state`. */
  readonly bootId: string;
  /** Absolute URL the container posts every report to (./agent-route). Unused
   * by a container that reaches the sink in process, which still presents the
   * bearer below — the identity is the part the return path decides on. */
  readonly reportUrl: string;
  /** The bearer the container presents on every report (./agent-crypto). Bound
   * to `bootId`, which is what makes the lane a fact of this boot. */
  readonly reportToken: string;
  readonly provider: SandboxProvider;
  readonly tools: readonly SandboxToolSpec[];
  /** The standing instruction file the session loads as extra context. */
  readonly instructions: string;
  readonly browser: SandboxBrowser | null;
};

/** What the client asked for, once the runner has resolved it against the
 * transcript. `interrupt` is not here — it is its own port method, because it
 * must reach a container that is mid-turn and takes no message. */
export type SandboxTurn = {
  readonly turnId: string;
  readonly kind: "user_message" | "steer" | "follow_up";
  readonly text: string;
  readonly images: readonly { readonly data: string; readonly mimeType: string }[];
  /** Prior turns to seed with — empty when the container reported that its live
   * session already holds the conversation. */
  readonly seed: readonly SandboxSeedTurn[];
};

/**
 * What the sink makes of one report.
 *
 * A refusal is a VALUE with the status the HTTP transport owes its caller, so
 * the route is a mapping rather than a second copy of the decision, and the
 * in-process transport reads the same refusal instead of inventing one.
 */
export type SandboxReportAnswer =
  | { readonly ok: true; readonly reply: AgentReportReply }
  | { readonly ok: false; readonly status: 400 | 401; readonly error: string };

/**
 * The port's RETURN direction: one entry every report arrives through.
 *
 * `identity` is the container's report bearer and `body` is the report as it
 * left the container — TEXT, because that is what crosses the wire and what the
 * sink must parse and schema-check before any of it becomes a transcript entry
 * or a vault write. A container is a process the user's own agent runs shell
 * commands inside; its reports are input from a place the model reaches, not a
 * trusted peer's RPC.
 *
 * THE LANE IS NOT A PARAMETER. It is resolved from `identity` — which boot the
 * bearer names — because the lane decides whose undo surface owns a write, and
 * a container that could state its own lane would be claiming a different one.
 * That is also why this is a sink rather than a callback each adapter binds: a
 * bound lane is the same fact derived a second way.
 */
export type SandboxReportSink = (identity: string, body: string) => Promise<SandboxReportAnswer>;

export type SandboxPort = {
  /**
   * What the container currently holds. NEVER throws and never reports a
   * transport failure as anything but `cold`: this call is the runner's only
   * way to notice the filesystem was wiped, so a rejection here would turn a
   * routine wake into a broken chat.
   */
  state(): Promise<SandboxState>;
  /** Bring the agent daemon up and hand it its identity, tools and credential
   * placeholder. Idempotent for a given `bootId`. */
  boot(boot: SandboxBoot): Promise<SandboxOutcome>;
  /** Put vault bytes under `./vault`, where pi's native file tools find them. */
  materialize(push: SandboxVaultPush): Promise<SandboxOutcome>;
  /**
   * Hand the container a turn and RETURN. Must not await the turn: a delegation
   * or routine runs for up to ten minutes and a Durable Object that waited on
   * one would hold an invocation open for the whole of it. Progress arrives
   * later, over the report route.
   */
  dispatch(turn: SandboxTurn): Promise<SandboxOutcome>;
  /** Ask the in-flight turn to stop. */
  interrupt(): Promise<SandboxOutcome>;
  /** Drop the container. The provider disconnect path calls this so a
   * credential-bearing egress route cannot outlive the credential. */
  shutdown(): Promise<void>;
};
