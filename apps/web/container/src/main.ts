// ---------------------------------------------------------------------------
// The agent daemon: the process the Worker starts inside the container.
//
// It answers exactly the five paths in `CONTAINER_API` and nothing else. The
// caller is the user's own Durable Object over the sandbox's control plane, and
// the shape of every handler here is dictated by one rule from that side:
//
//     A DURABLE OBJECT NEVER WAITS FOR A TURN.
//
// So `POST /v1/turn` accepts the turn, answers 202 and runs it in the
// background. Everything the turn produces — streamed events, tool calls, the
// agent's own file writes, the end — leaves through the report route
// (./reporter) as its own short request. A daemon that answered the dispatch
// with the turn's result would hold a Durable Object invocation open for up to
// ten minutes, with the user's sockets and vault manifest behind it.
//
// EVERY WAKE IS A COLD START. The container's filesystem is deleted when it
// sleeps, which for an agent nobody is talking to is most of the time. `boot`
// and `vault` are therefore not first-run steps but the ordinary path, and the
// state this file keeps — which boot it is running, which vault revision it
// holds, how far its session is seeded — exists precisely because the object
// cannot know any of it.
//
// State is process-global. One container is one user's agent; there is no
// second tenant to keep apart, and a registry would be indirection over a
// singleton the platform already guarantees.
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  AGENT_CONTAINER_PORT,
  CONTAINER_API,
  CONTAINER_VAULT_DIR,
  base64ToBytes,
  type ContainerBoot,
  type ContainerState,
  type ContainerTurn,
  type ContainerVaultPush,
} from "./protocol";
import { createBrowserTool } from "./browser-tool";
import {
  createEventStream,
  createReporter,
  resolveReportTarget,
  type EventStream,
  type Reporter,
} from "./reporter";
import { hostRelayTools, type ContainerTool } from "./tools";
import { createContainerSession, type ContainerSession } from "./pi/session";
import { createVaultWatcher, type VaultWatcher } from "./vault-watcher";

/** `toRevision` on a push that is NOT the last chunk. The revision advances
 * only when the whole push has landed, so a materialization interrupted halfway
 * leaves the container reporting the old one and the next wake re-materializes
 * rather than believing a partial vault. */
const CHUNK_CONTINUES = -1;

/** Largest request body accepted. Vault pushes carry file bytes and the object
 * chunks them, so this is generous — but an unbounded body is this process's
 * memory. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Request shapes
//
// The types in ./protocol are the contract; these schemas are the RUNTIME check
// for them. They are tied together by assignment rather than by comment: each
// parser returns the protocol type, so a schema that drifts from the contract
// fails to compile.
// ---------------------------------------------------------------------------

const OBJECT = { additionalProperties: false } as const;

const BootSchema = Type.Object(
  {
    bootId: Type.String({ minLength: 1 }),
    reportUrl: Type.String(),
    reportToken: Type.String(),
    provider: Type.Object(
      {
        provider: Type.String({ minLength: 1 }),
        modelId: Type.String({ minLength: 1 }),
        baseUrl: Type.String({ minLength: 1 }),
        apiKey: Type.String(),
      },
      OBJECT,
    ),
    tools: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1 }),
          description: Type.String(),
          parameters: Type.Unknown(),
        },
        OBJECT,
      ),
    ),
    instructions: Type.String(),
    browserCdpUrl: Type.Union([Type.String(), Type.Null()]),
    browserCdpToken: Type.Union([Type.String(), Type.Null()]),
  },
  OBJECT,
);

const VaultPushSchema = Type.Object(
  {
    toRevision: Type.Number(),
    replaceAll: Type.Boolean(),
    upserted: Type.Array(
      Type.Object({ path: Type.String({ minLength: 1 }), bytesBase64: Type.String() }, OBJECT),
    ),
    removed: Type.Array(Type.String({ minLength: 1 })),
  },
  OBJECT,
);

const TurnSchema = Type.Object(
  {
    turnId: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal("user_message"),
      Type.Literal("steer"),
      Type.Literal("follow_up"),
    ]),
    text: Type.String(),
    images: Type.Array(Type.Object({ data: Type.String(), mimeType: Type.String() }, OBJECT)),
    seed: Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
          text: Type.String(),
        },
        OBJECT,
      ),
    ),
    seededThrough: Type.Number(),
  },
  OBJECT,
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Daemon = {
  readonly boot: ContainerBoot;
  readonly reporter: Reporter;
  readonly watcher: VaultWatcher;
  readonly tools: readonly ContainerTool[];
  /** Built on the first turn, not at boot: constructing it reaches the provider
   * runtime and reads resources, and a boot that answered slowly would eat into
   * the object's own invocation. */
  session: ContainerSession | null;
  /** Where the running turn's events go. The session outlives a turn, so its
   * one subscriber has to route to whichever turn is current. */
  stream: EventStream | null;
};

let daemon: Daemon | null = null;
let vaultRevision = 0;
let seededThrough = 0;
let activeTurn: string | null = null;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Reply = { readonly status: number; readonly body: unknown };

const ACCEPTED: Reply = { status: 202, body: { ok: true } };
const OK: Reply = { status: 200, body: { ok: true } };
const NOT_FOUND: Reply = { status: 404, body: { error: "no such path" } };

function currentState(): ContainerState {
  return {
    bootId: daemon?.boot.bootId ?? null,
    vaultRevision,
    seededThrough,
    busy: activeTurn !== null,
  };
}

async function handleBoot(body: unknown): Promise<Reply> {
  if (!Value.Check(BootSchema, body)) return malformed("boot");
  const boot: ContainerBoot = body;

  // Idempotent for a given bootId: the object re-boots whenever it cannot
  // recognize what the container is running, and re-running a live boot would
  // throw away the session it is about to use.
  if (daemon !== null && daemon.boot.bootId === boot.bootId) return OK;
  await teardown();

  const target = resolveReportTarget({ url: boot.reportUrl, token: boot.reportToken });
  if (target === null) {
    return refuse(
      "the boot carried no absolute report URL — the Worker is deployed without PUBLIC_HOST",
    );
  }
  const reporter = createReporter(target);

  const relays = hostRelayTools(boot.tools, { reporter, currentTurnId: () => activeTurn });
  if (!relays.ok) return refuse(relays.error);
  const browser = createBrowserTool(boot.browserCdpUrl, boot.browserCdpToken);
  const tools = browser === null ? relays.tools : [...relays.tools, browser];

  await mkdir(CONTAINER_VAULT_DIR, { recursive: true });
  const watcher = createVaultWatcher({
    dir: CONTAINER_VAULT_DIR,
    report: async (ops) => {
      await reporter.send({ kind: "vault", ops: [...ops] });
    },
  });
  watcher.start();

  daemon = { boot, reporter, watcher, tools, session: null, stream: null };
  vaultRevision = 0;
  seededThrough = 0;
  return OK;
}

async function handleVault(body: unknown): Promise<Reply> {
  const current = daemon;
  if (current === null) return notBooted();
  if (!Value.Check(VaultPushSchema, body)) return malformed("vault push");
  const push: ContainerVaultPush = body;

  const applied = await materialize(current.watcher, push);
  if (!applied.ok) return refuse(applied.error);
  if (push.toRevision !== CHUNK_CONTINUES) vaultRevision = push.toRevision;
  return OK;
}

/**
 * Accept a turn and RETURN. Nothing here awaits the agent.
 *
 * `steer` and `follow_up` are pi's own mid-turn verbs — they fold a message
 * into the loop that is already running rather than starting one — so they are
 * accepted while busy. A second `user_message` is a second turn, and there is
 * only ever one.
 */
function handleTurn(body: unknown): Reply {
  const current = daemon;
  if (current === null) return notBooted();
  if (!Value.Check(TurnSchema, body)) return malformed("turn");
  const turn: ContainerTurn = body;

  if (activeTurn !== null) {
    if (turn.kind === "user_message") {
      return { status: 409, body: { error: "a turn is already running" } };
    }
    const session = current.session;
    if (session === null) {
      return { status: 409, body: { error: "the running turn has not started its session yet" } };
    }
    void session.queue(turn.kind, turn).catch((error: unknown) => {
      console.error("[turn] could not queue:", error);
    });
    return ACCEPTED;
  }

  activeTurn = turn.turnId;
  void runTurn(current, turn);
  return ACCEPTED;
}

async function handleInterrupt(): Promise<Reply> {
  // A container with no session has nothing running, which is the state this
  // asks for — an error would make the object surface a failure for a request
  // that already got what it wanted.
  await daemon?.session?.abort();
  return OK;
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

async function runTurn(current: Daemon, turn: ContainerTurn): Promise<void> {
  const events = createEventStream(current.reporter, turn.turnId);
  current.stream = events;
  let failure: string | null = null;

  try {
    const session =
      current.session ??
      (await createContainerSession({
        boot: current.boot,
        tools: current.tools,
        onEvent: (event) => current.stream?.push(event),
      }));
    current.session = session;
    await session.run(turn);
  } catch (error) {
    failure = toMessage(error);
  }

  const session = current.session;
  // Seeding is tracked from what the session ACCEPTED, not from what was sent:
  // a turn pi refused before the message entered the conversation leaves the
  // session unseeded, and the object has to send the transcript again.
  if (session !== null && session.isSeeded()) seededThrough = turn.seededThrough;

  await events.flush();
  await current.reporter.send({ kind: "turn_end", turnId: turn.turnId, error: failure });
  if (current.stream === events) current.stream = null;
  activeTurn = null;
}

async function teardown(): Promise<void> {
  const current = daemon;
  daemon = null;
  activeTurn = null;
  if (current === null) return;
  current.watcher.stop();
  const session = current.session;
  if (session === null) return;
  try {
    await session.abort();
  } catch (error) {
    console.error("[boot] could not abort the previous session:", error);
  }
  session.dispose();
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/**
 * Put the object's bytes under `./vault`.
 *
 * Every write is announced to the watcher, which is what stops it coming back
 * as an agent edit (./vault-watcher). A path that would land outside the vault
 * is refused rather than clamped: the caller is the object, so such a path is a
 * bug worth surfacing, not input to sanitize.
 */
async function materialize(
  watcher: VaultWatcher,
  push: ContainerVaultPush,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (push.replaceAll) {
    await rm(CONTAINER_VAULT_DIR, { recursive: true, force: true });
    await mkdir(CONTAINER_VAULT_DIR, { recursive: true });
    // Everything under the directory is now the host's by construction, so
    // there is nothing left to attribute and nothing to report.
    watcher.reset();
  }

  for (const file of push.upserted) {
    const full = vaultPath(file.path);
    if (full === null) return { ok: false, error: `${file.path} is not a path inside the vault` };
    const bytes = base64ToBytes(file.bytesBase64);
    if (bytes === null) return { ok: false, error: `${file.path} did not carry valid base64` };
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    await watcher.noteSelfChange(file.path);
  }

  for (const path of push.removed) {
    const full = vaultPath(path);
    if (full === null) return { ok: false, error: `${path} is not a path inside the vault` };
    await rm(full, { force: true });
    await watcher.noteSelfChange(path);
  }
  return { ok: true };
}

/** The absolute path `relPath` names inside the vault, or `null` when it names
 * something outside it. */
function vaultPath(relPath: string): string | null {
  const full = resolve(CONTAINER_VAULT_DIR, relPath);
  const rel = relative(CONTAINER_VAULT_DIR, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function route(request: IncomingMessage): Promise<Reply> {
  const path = (request.url ?? "").split("?")[0] ?? "";
  if (request.method === "GET") {
    return path === CONTAINER_API.state ? { status: 200, body: currentState() } : NOT_FOUND;
  }
  if (request.method !== "POST") return NOT_FOUND;
  if (
    path !== CONTAINER_API.boot &&
    path !== CONTAINER_API.vault &&
    path !== CONTAINER_API.turn &&
    path !== CONTAINER_API.interrupt
  ) {
    return NOT_FOUND;
  }

  const body = await readBody(request);
  if (!body.ok) return refuse(body.error);
  switch (path) {
    case CONTAINER_API.boot:
      return handleBoot(body.value);
    case CONTAINER_API.vault:
      return handleVault(body.value);
    case CONTAINER_API.turn:
      return handleTurn(body.value);
    case CONTAINER_API.interrupt:
      return handleInterrupt();
  }
}

function readBody(
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  return new Promise((settle) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        settle({ ok: false, error: "request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        settle({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        settle({ ok: false, error: "request body was not JSON" });
      }
    });
    request.on("error", (error) => {
      settle({ ok: false, error: toMessage(error) });
    });
  });
}

function respond(response: ServerResponse, reply: Reply): void {
  const payload = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  void (async () => {
    try {
      respond(response, await route(request));
    } catch (error) {
      console.error("[daemon] unhandled:", error);
      respond(response, { status: 500, body: { error: toMessage(error) } });
    }
  })();
});

server.on("error", (error) => {
  // A second daemon on a container that already has one is the realistic case,
  // and the right outcome is for the newcomer to stand down: the live daemon
  // holds the port, the boot that follows reaches it, and it re-boots. Said in
  // one line rather than as an unhandled 'error' event, whose stack trace in a
  // container log reads like the image is broken.
  console.error(`[daemon] cannot listen on ${AGENT_CONTAINER_PORT}: ${toMessage(error)}`);
  process.exit(1);
});

server.listen(AGENT_CONTAINER_PORT, () => {
  console.log(`[daemon] listening on ${AGENT_CONTAINER_PORT}`);
});

// ---------------------------------------------------------------------------

function refuse(error: string): Reply {
  return { status: 400, body: { error } };
}

function malformed(what: string): Reply {
  return refuse(`the ${what} payload did not match the container protocol`);
}

function notBooted(): Reply {
  return { status: 409, body: { error: "the container has not booted" } };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
