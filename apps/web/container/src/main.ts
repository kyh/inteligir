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
import { mkdir } from "node:fs/promises";

import {
  AGENT_CONTAINER_PORT,
  CONTAINER_API,
  CONTAINER_REFUSAL,
  CONTAINER_VAULT_DIR,
  type ContainerBoot,
  type ContainerState,
  type ContainerTurn,
} from "./protocol";
import { createBrowserTool } from "./browser-tool";
import {
  createEventStream,
  createReporter,
  resolveReportTarget,
  type EventStream,
  type Reporter,
} from "./reporter";
import { parseBoot, parseTurn, parseVaultPush } from "./requests";
import { hostRelayTools, type ContainerTool } from "./tools";
import { createContainerSession, type ContainerSession } from "./pi/session";
import { materialize } from "./vault-materialize";
import { createVaultReport } from "./vault-report";
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
    // Read off the session rather than tracked beside it: seeding is a property
    // of the live session, and a session that refused the prompt its seed rode
    // in with never took the conversation. A boot builds a new one, so a fresh
    // container reports `false` by construction.
    seeded: daemon?.session?.isSeeded() ?? false,
    busy: activeTurn !== null,
  };
}

async function handleBoot(body: unknown): Promise<Reply> {
  const boot = parseBoot(body);
  if (boot === null) return malformed("boot");

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
    // The object's ANSWER is the point of this call, not a courtesy: it says
    // which of the agent's writes the vault of record refused, and which
    // revision the container may now claim to hold (./vault-report).
    report: createVaultReport({
      send: (report) => reporter.send(report),
      heldRevision: () => vaultRevision,
      setRevision: (revision) => {
        vaultRevision = revision;
      },
      tellAgent,
    }),
  });
  watcher.start();

  daemon = { boot, reporter, watcher, tools, session: null, stream: null };
  vaultRevision = 0;
  return OK;
}

async function handleVault(body: unknown): Promise<Reply> {
  const current = daemon;
  if (current === null) return notBooted();
  const push = parseVaultPush(body);
  if (push === null) return malformed("vault push");

  const applied = await materialize(CONTAINER_VAULT_DIR, current.watcher, push);
  if (!applied.ok) return refuse(applied.error);
  if (push.toRevision !== CHUNK_CONTINUES) vaultRevision = push.toRevision;
  return OK;
}

/**
 * Say something to the model mid-turn, from the DAEMON.
 *
 * The only caller is the vault report: the agent's own file tools already
 * answered "written", and a refusal the model never reads is a model that goes
 * on building on a note the user does not have. With no session to steer there
 * is nothing to correct and nothing to retry, so it is logged — loudly, because
 * the alternative reading of the silence is that everything landed.
 */
async function tellAgent(text: string): Promise<void> {
  const session = daemon?.session;
  if (session === null || session === undefined) {
    console.error(`[vault] no running session to tell:\n${text}`);
    return;
  }
  try {
    await session.notify(text);
  } catch (error) {
    console.error("[vault] could not tell the agent what was refused:", error);
  }
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
  const turn = parseTurn(body);
  if (turn === null) return malformed("turn");

  if (activeTurn !== null) {
    if (turn.kind === "user_message") {
      return { status: 409, body: { error: CONTAINER_REFUSAL.turnInFlight } };
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

  await events.flush();
  // The turn is OVER before it is REPORTED. That ordering is load-bearing for
  // the background lane: the object dispatches the next queued task from inside
  // this very report, and a daemon still holding `activeTurn` while announcing
  // that the turn ended would deadlock the queue on its own completion notice.
  if (current.stream === events) current.stream = null;
  activeTurn = null;
  await current.reporter.send({ kind: "turn_end", turnId: turn.turnId, error: failure });
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
  return { status: 409, body: { error: CONTAINER_REFUSAL.notBooted } };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
