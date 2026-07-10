// ---------------------------------------------------------------------------
// Pairing — exchange the desktop's one-time pairing code for a durable device
// token over a one-shot raw WebSocket (ws-protocol `pair` frame → `paired`).
// PURE: the WebSocket implementation and the environment store are injected,
// so tests drive the whole flow with fakes. Failures are VALUES ({ok:false}),
// never throws — a wrong code, an unreachable host, and a timeout all land in
// the same result shape the pairing screen renders.
//
// `parsePairingInput` parses what the desktop Settings → Remote access block
// actually shows the user: one or more `ws://<lan-ip>:<port>` URLs ("or"-
// joined) plus a separate base64url one-time code — pasted together or one at
// a time — and tolerates a future combined form (`ws://host:port#<code>` or
// `?token=<code>`).
// ---------------------------------------------------------------------------

import { WS_CLOSE_UNAUTHORIZED, encodeFrame, parseServerFrame } from "@repo/features/ws-protocol";
import type { WsConstructor, WsLike } from "@repo/features/ws-bridge";
import type { EnvironmentStore, KnownEnvironment } from "./environment-store";

const PAIRING_TIMEOUT_MS = 15_000;

export type PairResult = { ok: true; env: KnownEnvironment } | { ok: false; error: string };

export type PairOptions = {
  /** `ws://<addr>:<port>` — from `parsePairingInput` or typed by hand. */
  wsUrl: string;
  /** The one-time code shown in the desktop's Settings → Remote access. */
  pairingToken: string;
  /** This phone's name, shown in the desktop's paired-devices list. */
  deviceName: string;
  /** Where the paired environment is persisted on success. */
  store: EnvironmentStore;
  /** Defaults to globalThis.WebSocket (React Native provides one). */
  webSocketImpl?: WsConstructor;
  /** Overridable for tests; defaults to 15s. */
  timeoutMs?: number;
};

/** The environment's display name — the host part of the ws URL. */
function hostnameOf(wsUrl: string): string {
  const match = /^wss?:\/\/([^/?#]+)/i.exec(wsUrl.trim());
  const host = match?.[1];
  if (host === undefined) return wsUrl.trim();
  const colon = host.lastIndexOf(":");
  // Strip a trailing `:port` (but not an IPv6 interior colon — those hosts
  // are bracketed, and the bracket check keeps them whole).
  return colon !== -1 && !host.slice(colon).includes("]") ? host.slice(0, colon) : host;
}

/**
 * One-shot pairing handshake: connect, present the pairing code, and on the
 * host's `paired` frame persist + resolve the new environment. The socket is
 * closed either way — the connection runtime reconnects with the durable
 * device token, not this socket.
 */
export function pairWithHost(options: PairOptions): Promise<PairResult> {
  const WebSocketImpl = options.webSocketImpl ?? globalThis.WebSocket;
  const wsUrl = options.wsUrl.trim();
  const timeoutMs = options.timeoutMs ?? PAIRING_TIMEOUT_MS;

  let socket: WsLike;
  try {
    socket = new WebSocketImpl(wsUrl);
  } catch {
    return Promise.resolve({ ok: false, error: `Could not connect to ${wsUrl}.` });
  }

  return new Promise<PairResult>((resolve) => {
    let settled = false;
    const finish = (result: PairResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close(1000, "pairing complete");
      } catch {
        // Closing an already-dead socket is fine.
      }
      // oxlint-disable-next-line promise/no-multiple-resolved -- open/message/close/timeout race, but the `settled` latch above guarantees exactly one resolve
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "Timed out connecting to the desktop." });
    }, timeoutMs);

    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      socket.send(
        encodeFrame({
          t: "pair",
          pairingToken: options.pairingToken.trim(),
          deviceName: options.deviceName,
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const frame = parseServerFrame(event.data);
      if (frame === null || frame.t !== "paired") return;
      const env: KnownEnvironment = {
        name: hostnameOf(wsUrl),
        wsUrl,
        deviceId: frame.deviceId,
        deviceToken: frame.deviceToken,
      };
      options.store.save(env);
      finish({ ok: true, env });
    });
    socket.addEventListener("close", (event) => {
      if (event.code === WS_CLOSE_UNAUTHORIZED) {
        finish({ ok: false, error: "Pairing code rejected or expired." });
        return;
      }
      finish({
        ok: false,
        error: "Could not connect to the desktop. Check the address and that remote access is on.",
      });
    });
    // A close event always follows; this only prevents an unhandled error
    // crash under implementations that require an error listener.
    socket.addEventListener("error", () => {});
  });
}

// ---------------------------------------------------------------------------
// Pairing-input parsing
// ---------------------------------------------------------------------------

/** Whatever fields the pasted text contained; the pairing screen prefills
 * from these and asks for the rest. */
export type ParsedPairingInput = {
  readonly wsUrl: string | null;
  readonly pairingToken: string | null;
};

const WS_URL_RE = /wss?:\/\/[^\s,;"'<>]+/gi;
// Pairing codes are 32 random bytes base64url'd (43 chars); require a long
// standalone run so prose around a pasted code never matches.
const TOKEN_RE = /(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{20,})(?=$|[^A-Za-z0-9_-])/;
const QUERY_TOKEN_RE = /[?&](?:token|pair|code)=([A-Za-z0-9_-]+)/i;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}>'"]+$/;

/**
 * Pull a ws URL and/or a pairing code out of free-form pasted text. Tolerant
 * of whitespace, several "or"-joined URLs (first wins), surrounding prose,
 * and a token embedded in the URL's fragment or query.
 */
export function parsePairingInput(text: string): ParsedPairingInput {
  const urls = text.match(WS_URL_RE) ?? [];
  let wsUrl: string | null = null;
  let pairingToken: string | null = null;

  const first = urls[0];
  if (first !== undefined) {
    const cleaned = first.replace(TRAILING_PUNCTUATION_RE, "");
    const fragmentToken = /#([A-Za-z0-9_-]{20,})$/.exec(cleaned)?.[1];
    const queryToken = QUERY_TOKEN_RE.exec(cleaned)?.[1];
    pairingToken = fragmentToken ?? queryToken ?? null;
    // The host address is everything before the fragment/query.
    const cut = Math.min(
      ...[cleaned.indexOf("#"), cleaned.indexOf("?"), cleaned.length].filter(
        (index) => index !== -1,
      ),
    );
    const base = cleaned.slice(0, cut).replace(/\/+$/, "");
    wsUrl = base === "" ? null : base;
  }

  if (pairingToken === null) {
    // Search the text with URLs blanked out, so a code never gets scavenged
    // from inside an address.
    const remainder = text.replace(WS_URL_RE, " ");
    pairingToken = TOKEN_RE.exec(remainder)?.[1] ?? null;
  }

  return { wsUrl, pairingToken };
}
