// ---------------------------------------------------------------------------
// The container's outbound half: everything the agent produces leaves here.
//
// The Durable Object drives the daemon over short request/response calls and
// never waits for a turn (./protocol). So the turn does not answer the call
// that started it — it reports, and this module is the only thing in the image
// that speaks to the Worker. One authenticated route, one bearer, one shape.
//
// ONE ATTEMPT PER REPORT, deliberately. Retrying is not safe here: an `events`
// batch that timed out after the object folded it into the transcript would be
// folded twice on the retry, and a duplicated `message_end` is a duplicated
// assistant message in the user's chat. A dropped batch loses progress the
// turn's own `turn_end` still closes out; a duplicated one corrupts the record.
// Failures are logged and surfaced as values — a tool report that does not
// land becomes an error result the model can read.
//
// The report target comes from the BOOT payload rather than this process's
// environment, even though the Worker sets `INTELIGIR_REPORT_URL` and
// `INTELIGIR_REPORT_TOKEN` on the session too. A wake reuses a daemon that is
// already running (the Worker starts it under a fixed process id), and that
// process's environment still holds the previous boot's token — which the
// object no longer accepts. The environment is a fallback for a payload that
// names no absolute URL; the Worker refuses to boot a real container in that
// state, so this is defence rather than a live path, and it is here because
// the alternative is handing `fetch` a relative URL and getting back an error
// about parsing rather than about the deployment.
// ---------------------------------------------------------------------------

import {
  REPORT_AUTH_HEADER,
  reportTimeoutMs,
  type AgentReport,
  type AgentReportReply,
} from "./protocol";

/** Where reports go, and what proves they came from this container. */
export type ReportTarget = { readonly url: string; readonly token: string };

export type Reporter = {
  /**
   * Post one report. `null` means it did not land — the caller decides what
   * that means, because it differs per kind: a lost event batch is progress
   * nobody sees, a lost tool report is a tool that cannot answer.
   */
  send(report: AgentReport, signal?: AbortSignal): Promise<AgentReportReply | null>;
};

/** Events per batch, and how long a partial batch waits for company. Both are
 * small: the user is watching a token stream, so latency is the thing being
 * traded, and the object folds each batch into the transcript as it arrives. */
const MAX_BATCH = 20;
const FLUSH_MS = 100;

export function createReporter(target: ReportTarget): Reporter {
  return {
    async send(report, signal) {
      // Per KIND, from the contract (./protocol): a `tool` report is answered
      // by a human on the other side, every other kind out of storage.
      const deadline = AbortSignal.timeout(reportTimeoutMs(report.kind));
      try {
        const response = await fetch(target.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [REPORT_AUTH_HEADER]: `Bearer ${target.token}`,
          },
          body: JSON.stringify(report),
          signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
        });
        if (!response.ok) {
          console.error(`[report] ${report.kind} refused (${response.status})`);
          return null;
        }
        return readReply(await response.json());
      } catch (error) {
        console.error(`[report] ${report.kind} failed:`, error);
        return null;
      }
    },
  };
}

/**
 * Absolute report target for a boot, or `null` when neither the payload nor the
 * environment names one.
 *
 * A relative `boot.reportUrl` is the symptom of a Worker deployed without
 * PUBLIC_HOST. It is treated as absent rather than dialed, because the failure
 * it produces otherwise ("Failed to parse URL") says nothing about the cause.
 */
export function resolveReportTarget(boot: ReportTarget): ReportTarget | null {
  const fromEnv = process.env["INTELIGIR_REPORT_URL"];
  const url = isAbsoluteHttpUrl(boot.url)
    ? boot.url
    : fromEnv !== undefined && isAbsoluteHttpUrl(fromEnv)
      ? fromEnv
      : null;
  if (url === null) return null;
  const token = boot.token !== "" ? boot.token : (process.env["INTELIGIR_REPORT_TOKEN"] ?? "");
  return token === "" ? null : { url, token };
}

/** A batched `events` stream for one turn. Order is preserved across flushes:
 * the object rebuilds the transcript from these, and events that arrive out of
 * order rebuild a different conversation. */
export type EventStream = {
  push(event: { type: string }): void;
  /** Send whatever is buffered and resolve once every prior flush has landed. */
  flush(): Promise<void>;
};

export function createEventStream(reporter: Reporter, turnId: string): EventStream {
  const buffered: { type: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Each flush chains onto the previous one so two batches can never be in
  // flight at once, which is the only way to keep their arrival order.
  let tail: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffered.length === 0) return tail;
    const events = buffered.splice(0, buffered.length);
    const post = async (): Promise<void> => {
      await reporter.send({ kind: "events", turnId, events });
    };
    tail = tail.then(post);
    return tail;
  };

  return {
    push(event) {
      buffered.push(event);
      if (buffered.length >= MAX_BATCH) {
        void flush();
        return;
      }
      timer ??= setTimeout(() => void flush(), FLUSH_MS);
    },
    flush,
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** The route answers with an `AgentReportReply`; anything else is a proxy, an
 * error page or a deployment mismatch, and reads as "no reply" rather than as
 * a shape the caller then indexes into. */
function readReply(value: unknown): AgentReportReply | null {
  if (typeof value !== "object" || value === null) return null;
  const record: Record<string, unknown> = { ...value };
  const kind = record["kind"];
  if (kind === "ack") return { kind: "ack" };
  if (kind === "tool") {
    const isError = record["isError"];
    const text = record["text"];
    if (typeof isError !== "boolean" || typeof text !== "string") return null;
    return { kind: "tool", isError, text };
  }
  if (kind === "vault") {
    const revision = record["revision"];
    const rejected = record["rejected"];
    if (typeof revision !== "number" || !Array.isArray(rejected)) return null;
    return {
      kind: "vault",
      revision,
      rejected: rejected.filter((entry): entry is string => typeof entry === "string"),
    };
  }
  return null;
}
