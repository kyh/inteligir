// ---------------------------------------------------------------------------
// The sandbox port over the real `@cloudflare/sandbox` binding.
//
// Everything here is SDK coupling and nothing here is policy: the runner, the
// tools, the transcript and the confirmation broker never see this file, and
// the scripted port (./fake-sandbox) implements the same contract. That split
// is what makes the agent testable on a machine with no Workers Paid plan and
// no built image, which is every machine this repo is developed on.
//
// This half carries the boot's `reportUrl` and `reportToken` into the container
// and the container dials them; the report itself lands on the SAME sink the
// scripted container reaches in process (../agent/agent-runner's
// `acceptReport`). Nothing about a lane is decided here.
//
// Three platform facts shape the code rather than being worked around:
//
//   • THE FILESYSTEM IS EPHEMERAL. There is no "install once" step — `boot`
//     runs on every wake, and the image is expected to hold everything a boot
//     needs. Nothing is downloaded here.
//   • A DURABLE OBJECT MAY HOLD SIX OUTBOUND CONNECTIONS PER REQUEST, and an
//     outbound connection pins it for at most fifteen minutes. So every call
//     below is a short request/response, the vault push is chunked rather than
//     streamed, and nothing subscribes to the container's event stream — the
//     container reports INTO the Worker instead.
//   • `keepAlive` bills provisioned memory and disk for the container's whole
//     wall-clock life and makes `destroy()` mandatory. It is not used: the
//     container is allowed to sleep, and a wake is an ordinary code path.
//
// The daemon is reached on its own port through `containerFetch` rather than by
// overriding `defaultPort`, which belongs to the SDK's own control server.
// ---------------------------------------------------------------------------

import {
  AGENT_CONTAINER_PORT,
  CONTAINER_API,
  CONTAINER_WORKSPACE_DIR,
  bytesToBase64,
  type ContainerBoot,
  type ContainerReset,
  type ContainerState,
  type ContainerTurn,
  type ContainerTurnAccepted,
  type ContainerVaultPush,
} from "@repo/agent-container/protocol";
import { getSandbox } from "@cloudflare/sandbox";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

import type { AgentSandbox } from "./sandbox-class";
import type {
  SandboxBoot,
  SandboxBootSession,
  SandboxDispatch,
  SandboxOutcome,
  SandboxPort,
  SandboxState,
  SandboxTurn,
  SandboxVaultPush,
} from "./sandbox-port";

/** The one session every call runs in. Named rather than generated so a wake
 * reattaches to the session a previous invocation created instead of leaving a
 * shell behind per request. */
const SESSION_ID = "inteligir-agent";

/** Command the image's daemon is started with. Baked at image build time — the
 * point of the Dockerfile is that a wake installs nothing. */
const DAEMON_COMMAND = "node /app/dist/main.js";

/** How long to wait for the daemon's port after starting it. Past this the boot
 * reports a sentence rather than hanging a chat turn on a container that is not
 * coming up. */
const DAEMON_READY_TIMEOUT_MS = 60_000;

/** Files per vault push. A whole-vault materialization on a cold wake can be
 * thousands of files; one request carrying all of them is a body no Durable
 * Object should assemble in memory. */
const PUSH_BATCH = 64;

export type CfSandboxDeps = {
  /** The binding, as `Env` declares it — so the SDK's generic constraint is
   * satisfied in exactly one place rather than at every call site. */
  readonly namespace: Env["AGENT_SANDBOX"];
  /** The sandbox's name — one container per user, named after their host. */
  readonly name: string;
};

export function createCfSandboxPort(deps: CfSandboxDeps): SandboxPort {
  const sandbox = (): AgentSandbox => getSandbox(deps.namespace, deps.name);

  const call = async (path: string, body: unknown): Promise<Response> =>
    sandbox().containerFetch(
      `http://container${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      AGENT_CONTAINER_PORT,
    );

  const post = async (path: string, body: unknown): Promise<SandboxOutcome> => {
    try {
      const response = await call(path, body);
      if (!response.ok) {
        return { ok: false, error: await refusal(response, path) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `the agent container is unreachable: ${toErrorMessage(error)}` };
    }
  };

  return {
    async state(): Promise<SandboxState> {
      // A cold container, a container mid-restart and a container whose image
      // is being replaced all surface here as a throw. All three mean the same
      // thing to the runner, so none of them is allowed to escape as one.
      try {
        const response = await call(CONTAINER_API.state, undefined);
        if (!response.ok) return { phase: "cold" };
        const parsed: unknown = await response.json();
        const reported = readContainerState(parsed);
        if (reported === null || reported.bootId === null) return { phase: "cold" };
        return {
          phase: "ready",
          bootId: reported.bootId,
          vaultRevision: reported.vaultRevision,
          conversation: reported.conversation,
          busy: reported.busy,
        };
      } catch {
        return { phase: "cold" };
      }
    },

    async boot(boot: SandboxBoot): Promise<SandboxOutcome> {
      try {
        const instance = sandbox();
        const session = await instance.createSession({
          id: SESSION_ID,
          cwd: CONTAINER_WORKSPACE_DIR,
          env: {
            // The identity the outbound interceptor reads off every provider
            // request, and the bearer the daemon reports with. It entitles the
            // container to SPEND this user's provider quota; it does not
            // contain, and cannot recover, a credential.
            INTELIGIR_REPORT_TOKEN: boot.reportToken,
            INTELIGIR_REPORT_URL: boot.reportUrl,
            INTELIGIR_BOOT_ID: boot.bootId,
          },
        });
        await session.startProcess(DAEMON_COMMAND, {
          // Named so a wake that finds a live daemon reuses it instead of
          // starting a second one on a port that is already bound.
          processId: "inteligir-agent-daemon",
        });
        await instance.startAndWaitForPorts({
          ports: [AGENT_CONTAINER_PORT],
          cancellationOptions: {
            waitInterval: 500,
            portReadyTimeoutMS: DAEMON_READY_TIMEOUT_MS,
          },
        });
      } catch (error) {
        return { ok: false, error: `the agent container did not start: ${toErrorMessage(error)}` };
      }
      const payload: ContainerBoot = {
        bootId: boot.bootId,
        reportUrl: boot.reportUrl,
        reportToken: boot.reportToken,
        provider: boot.provider,
        tools: boot.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        instructions: boot.instructions,
        browserCdpUrl: boot.browser?.cdpUrl ?? null,
        browserCdpToken: boot.browser?.token ?? null,
      };
      return post(CONTAINER_API.boot, payload);
    },

    reset(session: SandboxBootSession): Promise<SandboxOutcome> {
      return post(CONTAINER_API.reset, {
        instructions: session.instructions,
      } satisfies ContainerReset);
    },

    async materialize(push: SandboxVaultPush): Promise<SandboxOutcome> {
      // Chunked, and the LAST chunk carries the revision: a push interrupted
      // halfway leaves the container reporting the old revision, so the next
      // wake re-materializes rather than believing a partial vault.
      const batches = chunk(push.upserted, PUSH_BATCH);
      for (const [index, batch] of batches.entries()) {
        const final = index === batches.length - 1;
        const payload: ContainerVaultPush = {
          toRevision: final ? push.toRevision : -1,
          replaceAll: index === 0 && push.replaceAll,
          upserted: batch.map((file) => ({
            path: file.path,
            bytesBase64: bytesToBase64(file.bytes),
          })),
          removed: final ? push.removed : [],
        };
        const outcome = await post(CONTAINER_API.vault, payload);
        if (!outcome.ok) return outcome;
      }
      if (batches.length > 0) return { ok: true };
      // Nothing to upsert, but removals and the revision still have to land.
      return post(CONTAINER_API.vault, {
        toRevision: push.toRevision,
        replaceAll: push.replaceAll,
        upserted: [],
        removed: push.removed,
      } satisfies ContainerVaultPush);
    },

    async dispatch(turn: SandboxTurn): Promise<SandboxDispatch> {
      const payload: ContainerTurn = {
        turnId: turn.turnId,
        conversation: turn.conversation,
        kind: turn.kind,
        text: turn.text,
        images: turn.images,
        seed: turn.seed.map((entry) => ({ role: entry.role, text: entry.text })),
      };
      try {
        const response = await call(CONTAINER_API.turn, payload);
        if (!response.ok) {
          return { ok: false, error: await refusal(response, CONTAINER_API.turn) };
        }
        const accepted = readTurnAccepted(await response.json());
        // A daemon that took the turn without naming it leaves nothing to
        // listen for, so this refuses rather than guessing: the user reads a
        // sentence, which is recoverable, instead of watching a turn produce
        // silence, which is not.
        if (accepted === null) {
          return { ok: false, error: "the agent container accepted the turn without naming it" };
        }
        return { ok: true, turnId: accepted.turnId };
      } catch (error) {
        return { ok: false, error: `the agent container is unreachable: ${toErrorMessage(error)}` };
      }
    },

    interrupt(): Promise<SandboxOutcome> {
      return post(CONTAINER_API.interrupt, {});
    },

    async shutdown(): Promise<void> {
      try {
        await sandbox().destroy();
      } catch {
        // A container that is already gone is the state this asks for.
      }
    },
  };
}

/**
 * Why the daemon refused, in ITS words.
 *
 * The daemon answers a refusal with a sentence (`CONTAINER_REFUSAL` and its
 * neighbours) and that sentence is the one the user reads in the composer, so
 * it is relayed rather than replaced by the status that carried it: "the agent
 * container refused /v1/turn (409)" names the transport, not the reason, and
 * the scripted container answering the same condition would say something else
 * entirely. The status line is the fallback for a body that is not the
 * daemon's — a platform error page, a proxy, a container mid-replacement.
 */
async function refusal(response: Response, path: string): Promise<string> {
  const fallback = `the agent container refused ${path} (${response.status})`;
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return fallback;
    const record: Record<string, unknown> = { ...body };
    const error = record["error"];
    return typeof error === "string" && error !== "" ? error : fallback;
  } catch {
    return fallback;
  }
}

function readTurnAccepted(value: unknown): ContainerTurnAccepted | null {
  if (typeof value !== "object" || value === null) return null;
  const record: Record<string, unknown> = { ...value };
  const turnId = record["turnId"];
  if (typeof turnId !== "string" || turnId === "") return null;
  return { ok: true, turnId };
}

function readContainerState(value: unknown): ContainerState | null {
  if (typeof value !== "object" || value === null) return null;
  const record: Record<string, unknown> = { ...value };
  const bootId = record["bootId"];
  const vaultRevision = record["vaultRevision"];
  const conversation = record["conversation"];
  const busy = record["busy"];
  if (bootId !== null && typeof bootId !== "string") return null;
  if (typeof vaultRevision !== "number") return null;
  if (conversation !== null && typeof conversation !== "string") return null;
  if (typeof busy !== "boolean") return null;
  return { bootId, vaultRevision, conversation, busy };
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size));
  }
  return batches;
}
