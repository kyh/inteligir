// Vercel-style reporting for Cloudflare Worker Previews, run by .github/workflows/preview.yml.
//
//   node .github/scripts/worker-preview.mjs report <project> <building|ready|error> [url]
//   node .github/scripts/worker-preview.mjs close <project>...
//
// `close` deletes each project's Preview before it reports it gone. A project is a Worker's name.
//
// Two surfaces, both keyed by project so one PR can carry several Workers:
// - ONE sticky PR comment, a table with a row per project. The rows live as JSON in a hidden
//   marker inside the comment, so a report rewrites its own row and leaves the others alone.
// - A GitHub deployment per project on the PR's head commit, in the transient environment
//   "Preview – <project>", which is what draws "View deployment" on the PR. Created here rather
//   than through a job's `environment:`, because under workflow_run that would record the
//   default branch's commit and never reach the PR.
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER; `report` also needs HEAD_SHA and RUN_URL, and
// `close` CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
// No dependencies: Node's fetch against the REST APIs.

const MARKER = "<!-- worker-previews -->";
// who GITHUB_TOKEN comments as. Anyone can comment on a public repo, so only this author's marker
// is the sticky comment, and only its state is read back.
const BOT = "github-actions[bot]";
const STATE = /<!-- worker-previews-state:(?<rows>[A-Za-z0-9+/=]*) -->/u;
const api = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY}`;
const cloudflareApi = process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4";
const PAGE_SIZE = 100;

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`worker-preview: ${name} is not set`);
  }
  return value;
};

const gh = async (method, path, body) => {
  const init = {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      "x-github-api-version": "2022-11-28",
    },
    method,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${api}${path}`, init);
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : await response.json();
};

const ghRows = async function* ghRows(path) {
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page += 1) {
    const rows = await gh("GET", `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    yield* rows;
    if (rows.length < PAGE_SIZE) {
      return;
    }
  }
};

const environmentOf = (project) => `Preview – ${project}`;

const STATUS = {
  building: { deployment: "in_progress", icon: "🔄", label: "Building" },
  deleted: { deployment: "inactive", icon: "🗑️", label: "Deleted" },
  error: { deployment: "failure", icon: "❌", label: "Failed" },
  ready: { deployment: "success", icon: "✅", label: "Ready" },
};

const updatedAt = () =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
    .format(new Date())
    .replace(
      /, (?<time>\d+:\d\d) (?<half>AM|PM)$/u,
      (...match) => ` ${match.at(-1).time}${match.at(-1).half.toLowerCase()}`,
    );

const render = (rows) => {
  const lines = Object.entries(rows)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([project, row]) => {
      const { icon, label } = STATUS[row.state];
      const status = `${icon} [${label}](${row.inspect})`;
      const preview = row.url && row.state !== "deleted" ? `[Visit Preview](${row.url})` : "";
      return `| **${project}** | ${status} | ${preview} | ${row.updated} |`;
    });
  const state = Buffer.from(JSON.stringify(rows)).toString("base64");
  return [
    MARKER,
    `<!-- worker-previews-state:${state} -->`,
    "**The latest updates on your projects.** Learn more about [Cloudflare Worker Previews](https://developers.cloudflare.com/workers/previews/).",
    "",
    "| Name | Status | Preview | Updated (UTC) |",
    "| :--- | :----- | :------ | :------------ |",
    ...lines,
  ].join("\n");
};

const findComment = async (pr) => {
  for await (const comment of ghRows(`/issues/${pr}/comments`)) {
    if (comment.user?.login === BOT && comment.body?.startsWith(MARKER)) {
      return comment;
    }
  }
};

const upsertRows = async (pr, update) => {
  const comment = await findComment(pr);
  const encoded = comment?.body.match(STATE)?.groups?.rows;
  const rows = encoded ? JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) : {};
  if (!update(rows)) {
    return;
  }
  const body = render(rows);
  await (comment
    ? gh("PATCH", `/issues/comments/${comment.id}`, { body })
    : gh("POST", `/issues/${pr}/comments`, { body }));
};

// the environment is shared by every PR, so a PR's deployments are the ones its payload names.
// ref is the exact commit: a branch ref would resolve to whatever the branch holds by now.
const deploymentsOf = async (project, pr) => {
  const environment = encodeURIComponent(environmentOf(project));
  const deployments = [];
  for await (const deployment of ghRows(`/deployments?environment=${environment}`)) {
    if (String(deployment.payload?.pr) === pr) {
      deployments.push(deployment);
    }
  }
  return deployments;
};

const deploymentFor = async (project, pr, sha) => {
  const deployments = await deploymentsOf(project, pr);
  const existing = deployments.find((deployment) => deployment.sha === sha);
  return (
    existing ??
    gh("POST", "/deployments", {
      auto_merge: false,
      description: `Cloudflare Worker Preview of ${project}`,
      environment: environmentOf(project),
      payload: { pr },
      production_environment: false,
      ref: sha,
      required_contexts: [],
      transient_environment: true,
    })
  );
};

const deactivate = async (deployments) => {
  for (const deployment of deployments) {
    await gh("POST", `/deployments/${deployment.id}/statuses`, { state: "inactive" });
  }
};

const report = async (project, state, url) => {
  if (!STATUS[state] || state === "deleted") {
    throw new Error(`worker-preview: unknown state "${state}"`);
  }
  const pr = env("PR_NUMBER");
  const inspect = env("RUN_URL");
  const deployment = await deploymentFor(project, pr, env("HEAD_SHA"));
  await gh("POST", `/deployments/${deployment.id}/statuses`, {
    // auto_inactive would reach every PR's deployments in the shared environment
    auto_inactive: false,
    environment_url: url || undefined,
    log_url: inspect,
    state: STATUS[state].deployment,
  });
  if (state === "ready") {
    const deployments = await deploymentsOf(project, pr);
    await deactivate(deployments.filter((older) => older.id !== deployment.id));
  }
  await upsertRows(pr, (rows) => {
    rows[project] = { inspect, state, updated: updatedAt(), url: url || rows[project]?.url };
    return true;
  });
};

// Cloudflare's "Preview not found.": a PR that never went green never had one, so there is nothing
// to delete. Its code, not a 404, which a Worker's wrong name or a moved route answers too.
const PREVIEW_NOT_FOUND = /"code":\s*10025\b/u;

// any other refusal throws before a surface says the Preview is gone, since nothing comes back to
// retry it. cf's own delete exits 1 on a miss and on an expired token alike.
const deletePreview = async (project, pr) => {
  const path = `/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/workers/workers/${project}/previews/pr-${pr}`;
  const response = await fetch(`${cloudflareApi}${path}`, {
    headers: { authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}` },
    method: "DELETE",
  });
  const refusal = response.ok ? "" : await response.text();
  if (!response.ok && !PREVIEW_NOT_FOUND.test(refusal)) {
    throw new Error(`DELETE ${path}: ${response.status} ${refusal}`);
  }
};

const close = async (projects) => {
  const pr = env("PR_NUMBER");
  for (const project of projects) {
    await deletePreview(project, pr);
    await deactivate(await deploymentsOf(project, pr));
  }
  await upsertRows(pr, (rows) => {
    let changed = false;
    for (const project of projects) {
      if (rows[project]) {
        rows[project] = { ...rows[project], state: "deleted", updated: updatedAt() };
        changed = true;
      }
    }
    return changed;
  });
};

const [command, ...args] = process.argv.slice(2);
if (command === "report") {
  const [project, state, url] = args;
  await report(project, state, url);
} else if (command === "close") {
  await close(args);
} else {
  throw new Error("usage: worker-preview.mjs report <project> <state> [url] | close <project>...");
}
