import { z } from "zod";
import { clickButtonIn, parseEval } from "../harness/agent-browser";
import { OWNER } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { hostedVaultEnv, syncUntil } from "../harness/hosted-vault";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";
import { EDITOR, LIBRARY_GRID, WELCOME_STEP, libraryCard, welcomeStep } from "../harness/selectors";

const WELCOME_NOTE = "Welcome.md";
// the seeded note's heading (apps/cli/seed/Welcome.md)
const WELCOME_HEADING = "Welcome to inteligir";
const ACCOUNT_STEP = welcomeStep("account");
const PAGE_STATE = `JSON.stringify({ step: document.querySelector('${WELCOME_STEP}')?.dataset.welcomeStep ?? null, path: location.pathname, item: new URLSearchParams(location.search).get("item"), grid: document.querySelector('${LIBRARY_GRID}') !== null })`;
const pageStateSchema = z.object({
  grid: z.boolean(),
  item: z.string().nullable(),
  path: z.string(),
  step: z.string().nullable(),
});
const DEADLINE_MS = 30_000;

export const onboardingAccountBrowser: Scenario = {
  description:
    "`/welcome`'s account step against a Miniflare Worker opens on Create; an account made there with the invite code signs the instance in, its library syncs through that account, and the page moves on by itself to the library, where Welcome opens",
  name: "onboarding-account-browser",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    const app = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "solo" });
    const browser = await ctx.browser("onboarding-account");

    ctx.log("the account step opens on Create, asking for the invite code");
    await browser(["open", await app.browserUrl("/welcome?step=account")], 60_000);
    await browser(["wait", ACCOUNT_STEP], 90_000);
    await browser(["wait", `${ACCOUNT_STEP} input[autocomplete="new-password"]`], DEADLINE_MS);
    for (const [label, value] of [
      ["Name", "E2E Owner"],
      ["Email", OWNER.email],
      ["Password", OWNER.password],
      ["Invite code", E2E_INVITE_CODE],
    ] as const) {
      await browser(["find", "label", label, "fill", value, "--exact"]);
    }
    await clickButtonIn(browser, ACCOUNT_STEP, "Create account");

    ctx.log("the instance is signed in as the new account, and its library syncs through it");
    await pollUntil(
      async () => await app.api.cloud.status(),
      (status) => status.state === "signed-in" && status.accountEmail === OWNER.email,
      {
        deadlineMs: DEADLINE_MS,
        describe: (status) =>
          `the instance never signed in as ${OWNER.email}: ${JSON.stringify(status)}`,
        intervalMs: 200,
      },
    );
    await syncUntil(app.api, "the new account's first sync", "clean");

    ctx.log("the step moves on by itself, to the library, with nothing open");
    await pollUntil(
      async () => parseEval(await browser(["eval", PAGE_STATE]), pageStateSchema),
      (page) => page.step === null && page.path === "/" && page.item === null && page.grid,
      {
        deadlineMs: DEADLINE_MS,
        describe: (page) =>
          `the page never left the account step for the library: ${JSON.stringify(page)}`,
        intervalMs: 250,
      },
    );

    ctx.log("Welcome's card opens it");
    await browser(["wait", libraryCard(WELCOME_NOTE)], DEADLINE_MS);
    await browser(["dblclick", libraryCard(WELCOME_NOTE)]);
    await browser(["wait", EDITOR], DEADLINE_MS);
    await pollUntil(
      async () => await browser(["get", "text", EDITOR]),
      (text) => text.includes(WELCOME_HEADING),
      {
        deadlineMs: DEADLINE_MS,
        describe: (text) => `the workspace is not on ${WELCOME_NOTE}; the editor holds:\n${text}`,
      },
    );
  },
};
