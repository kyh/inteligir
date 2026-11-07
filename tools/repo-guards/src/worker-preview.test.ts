// .github/scripts/worker-preview.mjs sits in no workspace and only a merged workflow runs it, so
// this runs the script as the workflow does, against a stub of the two APIs it calls.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { assert, describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { REPO_ROOT } from "./repo";

const SCRIPT = path.join(REPO_ROOT, ".github/scripts/worker-preview.mjs");
const REPOSITORY = "kyh/inteligir";
const PROJECT = "inteligir-web";
const PR = "7";
const HEAD_SHA = "head-sha";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const BOT = "github-actions[bot]";
const MARKER = "<!-- worker-previews -->";
const PREVIEW_PATH = `/client/v4/accounts/${ACCOUNT}/workers/workers/${PROJECT}/previews/pr-${PR}`;

interface Comment {
  readonly id: number;
  readonly user: { readonly login: string };
  body: string;
}

interface Deployment {
  readonly id: number;
  readonly payload: { readonly pr: string };
  readonly sha: string;
}

// the fields of a request's JSON this suite reads: a comment's body, a deployment status's state
const requestBodySchema = z
  .looseObject({ body: z.string().optional(), state: z.string().optional() })
  .optional();

type RequestBody = z.infer<typeof requestBodySchema>;

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: RequestBody;
}

// a row of the comment's state, as the script writes it or as a stranger plants one
interface StateRow {
  readonly state: string;
  readonly inspect?: string;
  readonly updated?: string;
  readonly url?: string;
}

// Cloudflare's refusal of a delete: a status, and the code its envelope carries
interface DeleteRefusal {
  readonly status: number;
  readonly code: number;
  readonly message: string;
}

interface Seed {
  readonly comments?: readonly Comment[];
  readonly deployments?: readonly Deployment[];
  readonly deleteRefusal?: DeleteRefusal;
}

interface Stub {
  readonly origin: string;
  readonly comments: Comment[];
  readonly seen: Seen[];
}

const addressSchema = z.object({ port: z.number() });

const stickyBody = (rows: Readonly<Record<string, StateRow>>): string =>
  `${MARKER}\n<!-- worker-previews-state:${Buffer.from(JSON.stringify(rows)).toString("base64")} -->\n`;

const pageOf = <T>(rows: readonly T[], url: URL): readonly T[] => {
  const page = Number(url.searchParams.get("page") ?? "1");
  const perPage = Number(url.searchParams.get("per_page") ?? "30");
  return rows.slice((page - 1) * perPage, page * perPage);
};

const bodyOf = async (incoming: IncomingMessage): Promise<RequestBody> => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return text.length === 0 ? undefined : requestBodySchema.parse(JSON.parse(text));
};

const send = (outgoing: ServerResponse, status: number, json: string): void => {
  outgoing.writeHead(status, { "content-type": "application/json" });
  outgoing.end(json);
};

// GitHub and Cloudflare at their documented routes, a list newest first and a page short of
// `per_page` once it runs out; a request it does not know is a 500, which fails the script
const serve = async (seed: Seed): Promise<Stub> => {
  const comments = (seed.comments ?? []).map((comment) => ({ ...comment }));
  const deployments = [...(seed.deployments ?? [])];
  const seen: Seen[] = [];
  const github = `/repos/${REPOSITORY}`;

  const answer = (outgoing: ServerResponse, method: string, url: URL, body: RequestBody): void => {
    const route = `${method} ${url.pathname}`;
    if (route === `GET ${github}/issues/${PR}/comments`) {
      send(outgoing, 200, JSON.stringify(pageOf(comments, url)));
    } else if (route === `POST ${github}/issues/${PR}/comments`) {
      const posted: Comment = {
        body: body?.body ?? "",
        id: comments.length + 1000,
        user: { login: BOT },
      };
      comments.push(posted);
      send(outgoing, 201, JSON.stringify(posted));
    } else if (method === "PATCH" && url.pathname.startsWith(`${github}/issues/comments/`)) {
      const patched = comments.find((comment) => url.pathname.endsWith(`/${comment.id}`));
      if (patched !== undefined) {
        patched.body = body?.body ?? "";
      }
      send(outgoing, patched === undefined ? 404 : 200, JSON.stringify(patched ?? {}));
    } else if (route === `GET ${github}/deployments`) {
      send(outgoing, 200, JSON.stringify(pageOf(deployments, url)));
    } else if (route === `POST ${github}/deployments`) {
      const created: Deployment = { id: 9000, payload: { pr: PR }, sha: HEAD_SHA };
      deployments.unshift(created);
      send(outgoing, 201, JSON.stringify(created));
    } else if (method === "POST" && url.pathname.endsWith("/statuses")) {
      send(outgoing, 201, "{}");
    } else if (route === `DELETE ${PREVIEW_PATH}`) {
      const refusal = seed.deleteRefusal;
      send(
        outgoing,
        refusal?.status ?? 200,
        JSON.stringify({
          errors: refusal === undefined ? [] : [{ code: refusal.code, message: refusal.message }],
          messages: [],
          result: null,
          success: refusal === undefined,
        }),
      );
    } else {
      send(outgoing, 500, JSON.stringify({ message: `the stub has no ${route}` }));
    }
  };

  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", "http://stub.test");
    const method = incoming.method ?? "GET";
    void bodyOf(incoming).then((body) => {
      seen.push({
        authorization: incoming.headers.authorization,
        body,
        method,
        path: url.pathname,
      });
      answer(outgoing, method, url, body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  });
  const { port } = addressSchema.parse(server.address());
  return { comments, origin: `http://127.0.0.1:${port}`, seen };
};

// a clean environment, so no suite run reaches either API on a token the machine holds
const runScript = async (
  stub: Stub,
  ...args: string[]
): Promise<{ readonly code: number | null; readonly stderr: string }> => {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    env: {
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      CLOUDFLARE_API_BASE_URL: `${stub.origin}/client/v4`,
      CLOUDFLARE_API_TOKEN: "cloudflare-token",
      GITHUB_API_URL: stub.origin,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_TOKEN: "github-token",
      HEAD_SHA,
      PR_NUMBER: PR,
      RUN_URL: "https://run.test/1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf-8").on("data", (chunk) => {
    stderr += String(chunk);
  });
  await once(child, "close");
  return { code: child.exitCode, stderr };
};

const othersDeployments = (count: number): Deployment[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    payload: { pr: "99" },
    sha: `other-${index}`,
  }));

// past the first page of 100, as a long-lived PR's is once other PRs have deployed since
const OLD_DEPLOYMENT: Deployment = { id: 500, payload: { pr: PR }, sha: HEAD_SHA };
const LONG_ENVIRONMENT = [...othersDeployments(120), OLD_DEPLOYMENT];

const statusPosts = (stub: Stub): readonly Seen[] =>
  stub.seen.filter((seen) => seen.path.endsWith("/statuses"));

const commentWrites = (stub: Stub): readonly Seen[] =>
  stub.seen.filter((seen) => seen.path.includes("/comments") && seen.method !== "GET");

describe("worker-preview.mjs report", () => {
  const rows = {
    other: {
      inspect: "https://run.test/0",
      state: "ready",
      updated: "then",
      url: "https://o.test",
    },
  };

  it("rewrites the bot's own comment, keeping the rows of its other projects", async () => {
    const stub = await serve({
      comments: [{ body: stickyBody(rows), id: 1, user: { login: BOT } }],
    });
    const { code, stderr } = await runScript(stub, "report", PROJECT, "building");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(commentWrites(stub).map((seen) => seen.path)).toStrictEqual([
      `/repos/${REPOSITORY}/issues/comments/1`,
    ]);
    expect(stub.comments[0]?.body).toContain("**other**");
    expect(stub.comments[0]?.body).toContain(`**${PROJECT}**`);
  });

  it("answers a stranger's comment that starts with the marker by posting its own", async () => {
    const planted = stickyBody({ other: { state: "not a state" } });
    const stub = await serve({
      comments: [{ body: planted, id: 1, user: { login: "someone" } }],
    });
    const { code, stderr } = await runScript(stub, "report", PROJECT, "building");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stub.comments[0]?.body).toBe(planted);
    expect(stub.comments[1]?.user.login).toBe(BOT);
    expect(stub.comments[1]?.body).toContain("Building");
  });

  it("reads the bot's comment past a stranger's, and none of the stranger's rows", async () => {
    const planted = stickyBody({
      planted: {
        inspect: "https://evil.test",
        state: "ready",
        updated: "x",
        url: "https://e.test",
      },
    });
    const stub = await serve({
      comments: [
        { body: planted, id: 1, user: { login: "someone" } },
        { body: stickyBody(rows), id: 2, user: { login: BOT } },
      ],
    });
    const { code } = await runScript(stub, "report", PROJECT, "building");
    expect(code).toBe(0);
    expect(stub.comments[0]?.body).toBe(planted);
    expect(stub.comments[1]?.body).toContain("**other**");
    expect(stub.comments[1]?.body).not.toContain("evil.test");
  });

  it("finds the head commit's deployment past the first page instead of making another", async () => {
    const stub = await serve({ deployments: LONG_ENVIRONMENT });
    const { code } = await runScript(stub, "report", PROJECT, "building");
    expect(code).toBe(0);
    expect(
      stub.seen.filter((seen) => seen.path.endsWith("/deployments") && seen.method === "POST"),
    ).toStrictEqual([]);
    expect(statusPosts(stub).map((seen) => seen.path)).toStrictEqual([
      `/repos/${REPOSITORY}/deployments/500/statuses`,
    ]);
  });
});

describe("worker-preview.mjs close", () => {
  const ready = {
    [PROJECT]: {
      inspect: "https://run.test/0",
      state: "ready",
      updated: "t",
      url: "https://p.test",
    },
  };
  const closing = {
    comments: [{ body: stickyBody(ready), id: 1, user: { login: BOT } }],
    deployments: LONG_ENVIRONMENT,
  };

  it("deletes the Preview, then says so on every deployment and in the comment", async () => {
    const stub = await serve(closing);
    const { code, stderr } = await runScript(stub, "close", PROJECT);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const deleted = stub.seen.findIndex((seen) => seen.method === "DELETE");
    expect(stub.seen[deleted]).toMatchObject({
      authorization: "Bearer cloudflare-token",
      path: PREVIEW_PATH,
    });
    const [status] = statusPosts(stub);
    assert(status !== undefined, "close posted no deployment status");
    expect(status.path).toBe(`/repos/${REPOSITORY}/deployments/500/statuses`);
    expect(status.body?.state).toBe("inactive");
    expect(stub.seen.indexOf(status)).toBeGreaterThan(deleted);
    expect(stub.comments[0]?.body).toContain("Deleted");
  });

  it("takes Cloudflare's not-found as a PR that never had a Preview, and closes", async () => {
    const stub = await serve({
      ...closing,
      deleteRefusal: { code: 10_025, message: "Preview not found.", status: 404 },
    });
    const { code } = await runScript(stub, "close", PROJECT);
    expect(code).toBe(0);
    expect(stub.seen.some((seen) => seen.path === PREVIEW_PATH)).toBe(true);
    expect(stub.comments[0]?.body).toContain("Deleted");
  });

  it.each([
    { code: 10_000, message: "Authentication error", status: 401 },
    { code: 10_000, message: "Authentication error", status: 403 },
    { code: 10_007, message: "This Worker does not exist on your account.", status: 404 },
    { code: 10_013, message: "An unknown error has occurred.", status: 500 },
  ])("fails on a $status, code $code, with nothing reported gone", async (deleteRefusal) => {
    const stub = await serve({ ...closing, deleteRefusal });
    const { code, stderr } = await runScript(stub, "close", PROJECT);
    expect(code).not.toBe(0);
    expect(stderr).toContain(deleteRefusal.message);
    expect(statusPosts(stub)).toStrictEqual([]);
    expect(commentWrites(stub)).toStrictEqual([]);
    expect(stub.comments[0]?.body).not.toContain("Deleted");
  });
});
