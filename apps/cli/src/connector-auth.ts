import { spawn } from "node:child_process";
import { createServer } from "node:http";

import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { deferred } from "@repo/contract/deferred";
import { z } from "zod";

import type { Held } from "./credentials";

const CLIENT_NAME = "Inteligir on the command line";

const CALLBACK_PATH = "/callback";

const SIGN_IN_WAIT_MS = 5 * 60 * 1000;

export class SignInNeededError extends Error {
  constructor() {
    super("You're signed out. Run `inteligir sign-in` first.");
    this.name = "SignInNeededError";
  }
}

export const connectorOf = (site: string) => new URL(CONNECTOR_PATH, site);

interface Keeping {
  readonly held: Held;
  readonly save: (held: Held) => Promise<void>;
  readonly redirectUrl: string;
  readonly authorize: (url: URL) => void;
  readonly state?: string;
}

export const keptProvider = ({ authorize, held, redirectUrl, save, state }: Keeping) => {
  let current = held;
  let verifier = "";
  let discovered: OAuthDiscoveryState | undefined;

  const keep = async (next: Held) => {
    current = next;
    await save(next);
  };

  const provider: OAuthClientProvider = {
    clientInformation: () => current.client,
    clientMetadata: {
      application_type: "native",
      client_name: CLIENT_NAME,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUrl],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    codeVerifier: () => verifier,
    discoveryState: () => discovered,
    invalidateCredentials: async (scope) => {
      if (scope === "all" || scope === "discovery") {
        discovered = undefined;
      }

      if (scope === "all" || scope === "client") {
        await keep({ site: current.site });
      } else if (scope === "tokens") {
        await keep({ client: current.client, site: current.site });
      }
    },
    redirectToAuthorization: (url) => {
      authorize(url);
    },
    redirectUrl,
    saveClientInformation: async (client) => {
      await keep({ ...current, client });
    },
    saveCodeVerifier: (next) => {
      verifier = next;
    },
    saveDiscoveryState: (next) => {
      discovered = next;
    },
    saveTokens: async (tokens) => {
      await keep({ ...current, tokens });
    },
    tokens: () => current.tokens,
  };

  if (state !== undefined) {
    provider.state = () => state;
  }

  return provider;
};

export const signedInProvider = (held: Held, save: (held: Held) => Promise<void>) =>
  keptProvider({
    authorize: () => {
      throw new SignInNeededError();
    },
    held,
    redirectUrl: `http://127.0.0.1${CALLBACK_PATH}`,
    save,
  });

const SIGNED_IN_PAGE =
  "<!doctype html><meta charset=utf-8><link rel=icon href=data:,><title>Signed in</title><p>Signed in. You can close this tab.";

const REFUSED_PAGE =
  "<!doctype html><meta charset=utf-8><link rel=icon href=data:,><title>Not signed in</title><p>Signing in didn't finish. Run it again.";

const boundSchema = z.object({ port: z.number().int() });

export const listenForCallback = async (state: string) => {
  const { promise: answered, reject, resolve } = deferred<URLSearchParams>();

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();

      return;
    }

    const ok = url.searchParams.get("state") === state && url.searchParams.has("code");
    response.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
    response.end(ok ? SIGNED_IN_PAGE : REFUSED_PAGE);

    if (ok) {
      resolve(url.searchParams);
    } else {
      reject(new Error(url.searchParams.get("error_description") ?? "Signing in was refused."));
    }
  });

  const { promise: listening, resolve: listened } = deferred();
  server.listen(0, "127.0.0.1", () => {
    listened();
  });
  await listening;

  const { port } = boundSchema.parse(server.address());

  const timer = setTimeout(() => {
    reject(new Error("Signing in took too long. Run it again."));
  }, SIGN_IN_WAIT_MS);

  const redirected = async () => {
    try {
      return await answered;
    } finally {
      clearTimeout(timer);
      server.close();
    }
  };

  return { redirected, redirectUrl: `http://127.0.0.1:${String(port)}${CALLBACK_PATH}` };
};

const OPENERS: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  darwin: ["open"],
  linux: ["xdg-open"],
  win32: ["cmd", "/c", "start", '""'],
};

export const openInBrowser = (url: URL) => {
  const opener = OPENERS[process.platform];

  if (opener === undefined) {
    return;
  }

  const [command = "", ...args] = opener;
  const child = spawn(command, [...args, url.href], { detached: true, stdio: "ignore" });
  child.once("error", () => {
    child.unref();
  });
  child.unref();
};
