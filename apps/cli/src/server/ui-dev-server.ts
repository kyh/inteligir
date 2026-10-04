// Under the desktop shell's `tauri dev`, the window still loads this server's own origin, as a
// packaged one does, so its sign-in, its cookie and its socket are the ones a release runs. Only
// the page's files come from Vite's dev server instead of the bundle, so an edit lands with Vite's
// hot reload. The shell names Vite's address; a production server never honours it, and it may
// name only a loopback http origin.

import { loopbackRequestOrigin } from "./loopback-origin";

export const UI_DEV_URL_ENV_VAR = "INTELIGIR_UI_DEV_URL";

export const uiDevOrigin = (env: NodeJS.ProcessEnv, mode: "dev" | "prod"): string | null => {
  const raw = env[UI_DEV_URL_ENV_VAR];
  if (raw === undefined || raw === "" || mode === "prod") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${UI_DEV_URL_ENV_VAR} must be a URL, got ${JSON.stringify(raw)}`);
  }
  const origin = url.protocol === "http:" ? loopbackRequestOrigin(url.host) : null;
  if (origin === null) {
    throw new Error(`${UI_DEV_URL_ENV_VAR} must be a loopback http origin, got ${url.origin}`);
  }
  return origin;
};

// fetch has already undone the encoding the length and the header describe
const DROPPED_HEADERS = ["content-encoding", "content-length", "transfer-encoding"];

// the file as Vite answers it, for the path and query the page asked this server for
export const forwardToUiDevServer = async (origin: string, request: Request): Promise<Response> => {
  const asked = new URL(request.url);
  const upstream = await fetch(new URL(`${asked.pathname}${asked.search}`, origin), {
    headers: { accept: request.headers.get("accept") ?? "*/*" },
    method: request.method,
  });
  const headers = new Headers(upstream.headers);
  for (const name of DROPPED_HEADERS) {
    headers.delete(name);
  }
  return new Response(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
};
