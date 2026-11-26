import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";

import {
  connectorOf,
  keptProvider,
  listenForCallback,
  SignInNeededError,
  signedInProvider,
} from "./connector-auth";
import { credentialsPath, forgetHeld, readHeld, writeHeld } from "./credentials";
import type { Held } from "./credentials";
import { toolInputs, toolArguments, UsageError } from "./tool-args";
import type { InputProperty } from "./tool-args";

const CLIENT_INFO = { name: "inteligir", version: "1" } as const;

export interface Io {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly open: (url: URL) => void;
  readonly transport: (
    connector: URL,
    provider: OAuthClientProvider,
  ) => StreamableHTTPClientTransport;
}

const USAGE = `inteligir: your library, from the command line.

  inteligir sign-in [--site <address>]   sign in, in your browser
  inteligir sign-out                     forget the sign-in kept on this computer
  inteligir tools                        list what you can call
  inteligir help <tool>                  say what a tool takes
  inteligir <tool> [name=value ...]      call a tool, or pass it one JSON object

Values are read as JSON where a tool takes a number, a list or a yes/no,
and as text otherwise: inteligir search_library query="garden plans"`;

const siteOf = (raw: string | undefined) => {
  const site = raw ?? PRODUCTION_CLOUD_ORIGIN;

  if (!URL.canParse(site)) {
    throw new UsageError(`"${site}" isn't an address.`);
  }

  return new URL(site).origin;
};

const signIn = async (io: Io, words: readonly string[]) => {
  const { values } = parseArgs({
    args: [...words],
    options: { site: { type: "string" } },
    strict: true,
  });

  const site = siteOf(values.site ?? io.env.INTELIGIR_SITE);
  const file = credentialsPath(io.env);
  const prior = await readHeld(file);

  const held: Held =
    prior?.site === site && prior.client !== undefined ? { client: prior.client, site } : { site };

  const state = randomUUID();
  const { redirected, redirectUrl } = await listenForCallback(state);
  const connector = connectorOf(site);

  const provider = keptProvider({
    authorize: (url) => {
      io.err(`Opening your browser to sign in. If it doesn't open, visit:\n${url.href}`);
      io.open(url);
    },
    held,
    redirectUrl,
    save: async (next) => {
      await writeHeld(file, next);
    },
    state,
  });

  const asking = io.transport(connector, provider);

  try {
    await new Client(CLIENT_INFO).connect(asking);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
  }

  await asking.finishAuth(await redirected());
  const client = new Client(CLIENT_INFO);
  await client.connect(io.transport(connector, provider));
  await client.close();
  io.out(`Signed in to ${site}.`);
};

const signOut = async (io: Io) => {
  await forgetHeld(credentialsPath(io.env));
  io.out(
    "Signed out on this computer. To cut it off everywhere, disconnect it in Settings › Account › Connected assistants.",
  );
};

const connected = async (io: Io) => {
  const file = credentialsPath(io.env);
  const held = await readHeld(file);

  if (held?.tokens === undefined) {
    throw new SignInNeededError();
  }

  const provider = signedInProvider(held, async (next) => {
    await writeHeld(file, next);
  });

  const client = new Client(CLIENT_INFO);

  try {
    await client.connect(io.transport(connectorOf(held.site), provider));
  } catch (error) {
    throw error instanceof UnauthorizedError ? new SignInNeededError() : error;
  }

  return client;
};

const firstSentence = (text: string | undefined) => {
  const line = (text ?? "").split("\n", 1)[0] ?? "";
  const end = line.search(/[.:]\s/u);

  return end === -1 ? line : line.slice(0, end + 1);
};

const kindOf = (property: InputProperty | undefined) => {
  const types = property?.anyOf?.flatMap(({ type }) => (type === undefined ? [] : [type])) ?? [];

  if (types.length > 0) {
    return types.join(" or ");
  }

  const { type } = property ?? {};

  return Array.isArray(type) ? type.join(" or ") : (type ?? "any");
};

const listTools = async (io: Io, client: Client) => {
  const { tools } = await client.listTools();
  const width = Math.max(...tools.map(({ name }) => name.length));

  for (const tool of tools.toSorted((a, b) => a.name.localeCompare(b.name))) {
    io.out(`${tool.name.padEnd(width)}  ${firstSentence(tool.description)}`);
  }
};

const toolNamed = async (client: Client, name: string) => {
  const { tools } = await client.listTools();
  const tool = tools.find((listed) => listed.name === name);

  if (tool === undefined) {
    throw new UsageError(`There's no tool named "${name}". Run \`inteligir tools\` to list them.`);
  }

  return tool;
};

const describeTool = async (io: Io, client: Client, name: string) => {
  const tool = await toolNamed(client, name);
  const { properties = {}, required = [] } = toolInputs(tool.inputSchema);
  io.out(tool.description ?? tool.name);

  const names = Object.keys(properties);

  if (names.length > 0) {
    io.out("");
  }

  for (const property of names) {
    io.out(
      `  ${property}${required.includes(property) ? "" : "?"}: ${kindOf(properties[property])}`,
    );
  }
};

const callTool = async (io: Io, client: Client, name: string, words: readonly string[]) => {
  const tool = await toolNamed(client, name);
  const result = await client.callTool({ arguments: toolArguments(words, tool.inputSchema), name });

  const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : []));

  if (result.isError === true) {
    io.err(text.join("\n") || `${name} failed.`);

    return 1;
  }

  io.out(
    result.structuredContent === undefined
      ? text.join("\n")
      : JSON.stringify(result.structuredContent, null, 2),
  );

  return 0;
};

const withClient = async <T>(io: Io, work: (client: Client) => Promise<T>) => {
  const client = await connected(io);

  try {
    return await work(client);
  } finally {
    await client.close();
  }
};

export const run = async (io: Io, argv: readonly string[]) => {
  const [command, ...rest] = argv;

  try {
    switch (command) {
      case undefined:
      case "--help":
      case "-h": {
        io.out(USAGE);

        return 0;
      }

      case "sign-in": {
        await signIn(io, rest);

        return 0;
      }

      case "sign-out": {
        await signOut(io);

        return 0;
      }

      case "tools": {
        await withClient(io, async (client) => {
          await listTools(io, client);
        });

        return 0;
      }

      case "help": {
        const [name] = rest;

        if (name === undefined) {
          io.out(USAGE);

          return 0;
        }

        await withClient(io, async (client) => {
          await describeTool(io, client, name);
        });

        return 0;
      }

      default: {
        return await withClient(io, async (client) => await callTool(io, client, command, rest));
      }
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof SignInNeededError) {
      io.err(error.message);

      return 2;
    }

    throw error;
  }
};

export const defaultTransport = (connector: URL, provider: OAuthClientProvider) =>
  new StreamableHTTPClientTransport(connector, { authProvider: provider });
