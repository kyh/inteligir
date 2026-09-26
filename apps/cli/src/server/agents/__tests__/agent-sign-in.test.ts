import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { AgentsStatusResponse } from "@repo/api/local/agents/agents-schema";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";
import { bootTestApp, makeTempDir } from "../../__tests__/boot-app";
import type { BootedTestApp } from "../../__tests__/boot-app";
import { AgentPrefsStore } from "../agent-prefs-store";
import { createAgentAccounts } from "../agent-sign-in";
import type { AgentAccounts } from "../agent-sign-in";

const require = createRequire(import.meta.url);
const FAKE_AGENT = require.resolve("@repo/agent-runtime/test-support/fake-acp-agent");

const PAGE_CODE = "page-code#page-state";

// stands in for both vendor binaries over one store dir: claude's `auth status|login|logout` and
// codex's `login status` and `logout`, each reading or writing a marker the way the vendor's own
// store would. FAKE_CLAUDE_LOGIN picks how a login goes: wait (until a release file appears),
// fail, hang (a helper in its process group, so a cancel must kill the group), or code (a line
// pasted on stdin, which it exchanges only when it is the page's code).
const FAKE_VENDOR = `#!/bin/sh
store="$FAKE_VENDOR_STORE"
case "$1 $2" in
  "auth status")
    if [ -f "$store/claude" ]; then
      printf '%s' '{"loggedIn":true,"apiProvider":"firstParty","email":"ada@example.com","subscriptionType":"pro"}'
    else
      printf '%s' '{"loggedIn":false,"apiProvider":"firstParty","authMethod":"none"}'
      exit 1
    fi
    ;;
  "auth login")
    echo "Opening browser to sign in..."
    echo "If the browser didn't open, visit: https://claude.test/oauth/authorize?code=true"
    printf 'Paste code here if prompted > '
    case "$FAKE_CLAUDE_LOGIN" in
      fail)
        echo "Login failed: the code was refused" >&2
        exit 1
        ;;
      code)
        read -r pasted
        if [ "$pasted" != "${PAGE_CODE}" ]; then
          echo "Login failed: Invalid authorization code" >&2
          exit 1
        fi
        ;;
      hang)
        sleep 30 &
        echo $! > "$store/helper"
        wait
        ;;
      *)
        while [ ! -f "$store/release" ]; do sleep 0.05; done
        ;;
    esac
    touch "$store/claude"
    ;;
  "auth logout")
    rm -f "$store/claude"
    ;;
  "login status")
    if [ -f "$store/codex" ]; then
      echo "Logged in using ChatGPT" >&2
    else
      echo "Not logged in" >&2
      exit 1
    fi
    ;;
  "logout ")
    rm -f "$store/codex"
    ;;
esac
`;

const PRINTED_URL = "https://claude.test/oauth/authorize?code=true";

interface SignInHarness extends BootedTestApp {
  accounts: AgentAccounts;
  store: string;
  prefs: AgentPrefsStore;
}

const bootSignIn = async (login = "wait", signInCeilingMs?: number): Promise<SignInHarness> => {
  const dir = makeTempDir("agent-sign-in-", { realpath: true });
  const store = path.join(dir, "store");
  const dataDir = path.join(dir, "data");
  mkdirSync(store);
  mkdirSync(dataDir);
  const vendor = path.join(dir, "vendor");
  writeFileSync(vendor, FAKE_VENDOR, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    CLAUDE_CODE_EXECUTABLE: vendor,
    CODEX_PATH: vendor,
    FAKE_CLAUDE_LOGIN: login,
    FAKE_VENDOR_STORE: store,
    PATH: process.env.PATH,
  };
  // codex signs in through its adapter, which the fake agent stands in for, writing the marker
  // the fake vendor's `login status` reads.
  const spawnAdapter: AcpAgentRuntimeOptions["spawnAdapter"] = (_harness, adapterEnv, cwd) => ({
    child: spawn(process.execPath, [FAKE_AGENT], {
      cwd,
      env: {
        ...adapterEnv,
        FAKE_ACP_AUTH_FILE: path.join(store, "codex"),
        FAKE_ACP_MODE: "signIn",
      },
      stdio: ["pipe", "pipe", "pipe"],
    }),
  });
  const accounts = createAgentAccounts({ cwd: dataDir, env, signInCeilingMs, spawnAdapter });
  const booted = await bootTestApp({ accounts });
  return { ...booted, accounts, prefs: new AgentPrefsStore(booted.dataDir), store };
};

const accountOf = (status: AgentsStatusResponse, id: string) =>
  status.harnesses.find((harness) => harness.id === id);

const signingInOn = async (booted: BootedTestApp) => {
  const status = await booted.client.agents.status();
  return status.signingIn;
};

const outcomeOf = async (answer: Promise<{ outcome: string }>): Promise<string> => {
  const { outcome } = await answer;
  return outcome;
};

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("signing claude in", () => {
  it("runs its own login, shows the address it printed while it waits, and takes the default when none is chosen", async () => {
    const harness = await bootSignIn();
    const pending = harness.client.agents.signIn({ id: "claude" });
    await vi.waitFor(async () => {
      expect(await signingInOn(harness)).toEqual({
        acceptsCode: true,
        authUrl: PRINTED_URL,
        id: "claude",
      });
    });
    writeFileSync(path.join(harness.store, "release"), "");

    const answer = await pending;
    expect(answer.outcome).toBe("signed-in");
    expect(answer.status.signingIn).toBeNull();
    expect(accountOf(answer.status, "claude")).toMatchObject({
      account: { email: "ada@example.com", label: "Claude Pro", state: "signed-in" },
    });
    expect(answer.status.defaultId).toBe("claude");
    expect(harness.prefs.read()).toEqual({ defaultHarness: "claude" });
  });

  it("takes the default from a harness that is signed out", async () => {
    const harness = await bootSignIn();
    writeFileSync(path.join(harness.store, "release"), "");
    harness.prefs.write({ defaultHarness: "codex" });
    const answer = await harness.client.agents.signIn({ id: "claude" });
    expect(answer.status.defaultId).toBe("claude");
    expect(harness.prefs.read()).toEqual({ defaultHarness: "claude" });
  });

  it("leaves a default that is signed in where it is", async () => {
    const harness = await bootSignIn();
    writeFileSync(path.join(harness.store, "release"), "");
    writeFileSync(path.join(harness.store, "codex"), "");
    harness.prefs.write({ defaultHarness: "codex" });
    const answer = await harness.client.agents.signIn({ id: "claude" });
    expect(answer.status.defaultId).toBe("codex");
  });

  it("refuses a second sign-in while one runs", async () => {
    const harness = await bootSignIn();
    const first = harness.client.agents.signIn({ id: "claude" });
    await vi.waitFor(async () => {
      expect(await signingInOn(harness)).not.toBeNull();
    });

    const [refusal] = await safe(harness.client.agents.signIn({ id: "codex" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");

    await harness.client.agents.cancelSignIn({ id: "claude" });
    expect(await outcomeOf(first)).toBe("cancelled");
  });

  it("is cancelled with its whole process group, and nothing is signed in", async () => {
    const harness = await bootSignIn("hang");
    const pending = harness.client.agents.signIn({ id: "claude" });
    const helper = path.join(harness.store, "helper");
    await vi.waitFor(() => {
      expect(readFileSync(helper, "utf-8").trim()).not.toBe("");
    });

    const after = await harness.client.agents.cancelSignIn({ id: "claude" });
    expect(after.signingIn).toBeNull();
    const answer = await pending;
    expect(answer.outcome).toBe("cancelled");
    expect(accountOf(answer.status, "claude")).toMatchObject({ account: { state: "signed-out" } });
    const helperPid = Number(readFileSync(helper, "utf-8").trim());
    await vi.waitFor(() => {
      expect(processAlive(helperPid)).toBe(false);
    });
  });

  it("is ended with the server, so no login outlives it", async () => {
    const harness = await bootSignIn("hang");
    const pending = harness.client.agents.signIn({ id: "claude" });
    const helper = path.join(harness.store, "helper");
    await vi.waitFor(() => {
      expect(readFileSync(helper, "utf-8").trim()).not.toBe("");
    });

    await harness.accounts.dispose();
    expect(harness.accounts.signingIn()).toBeNull();
    expect(await outcomeOf(pending)).toBe("cancelled");
    const helperPid = Number(readFileSync(helper, "utf-8").trim());
    await vi.waitFor(() => {
      expect(processAlive(helperPid)).toBe(false);
    });
  });

  it("fails, not cancels, once its ceiling passes, and frees the slot for the next", async () => {
    const harness = await bootSignIn("hang", 300);
    const answer = await harness.client.agents.signIn({ id: "claude" });
    expect(answer).toMatchObject({
      detail: "Claude's sign-in was not finished in time; start it again.",
      outcome: "failed",
    });
    expect(answer.status.signingIn).toBeNull();
  });

  it("fails with the tail of what the vendor said when its login exits non-zero", async () => {
    const harness = await bootSignIn("fail");
    const answer = await harness.client.agents.signIn({ id: "claude" });
    expect(answer).toMatchObject({
      detail: "Claude could not finish signing in: Login failed: the code was refused",
      outcome: "failed",
    });
    expect(harness.prefs.read()).toEqual({});
  });

  it("signs out through the vendor, and the status says so at once", async () => {
    const harness = await bootSignIn();
    writeFileSync(path.join(harness.store, "claude"), "");
    expect(accountOf(await harness.client.agents.status(), "claude")).toMatchObject({
      account: { state: "signed-in" },
    });

    const answer = await harness.client.agents.signOut({ id: "claude" });
    expect(answer.outcome).toBe("signed-out");
    expect(accountOf(answer.status, "claude")).toMatchObject({ account: { state: "signed-out" } });
    expect(existsSync(path.join(harness.store, "claude"))).toBe(false);
  });
});

// wrapped, since an async function returning the sign-in's own promise would wait it out.
const waitingForCode = async (harness: SignInHarness) => {
  const pending = harness.client.agents.signIn({ id: "claude" });
  await vi.waitFor(async () => {
    const signingIn = await signingInOn(harness);
    expect(signingIn?.authUrl).toBe(PRINTED_URL);
  });
  return { pending };
};

describe("a code pasted from claude's sign-in page", () => {
  it("reaches the login waiting on it, which signs in with it", async () => {
    const harness = await bootSignIn("code");
    const { pending } = await waitingForCode(harness);

    const sent = await harness.client.agents.submitSignInCode({
      code: ` ${PAGE_CODE}\n`,
      id: "claude",
    });
    expect(sent).toEqual({ outcome: "sent" });

    const answer = await pending;
    expect(answer.outcome).toBe("signed-in");
    expect(accountOf(answer.status, "claude")).toMatchObject({ account: { state: "signed-in" } });
  });

  it("is answered incomplete when half of it is missing, and the login keeps waiting", async () => {
    const harness = await bootSignIn("code");
    const { pending } = await waitingForCode(harness);

    const [code] = PAGE_CODE.split("#");
    expect(
      await harness.client.agents.submitSignInCode({ code: code ?? "", id: "claude" }),
    ).toEqual({ outcome: "incomplete" });
    expect(await signingInOn(harness)).not.toBeNull();

    await harness.client.agents.submitSignInCode({ code: PAGE_CODE, id: "claude" });
    expect(await outcomeOf(pending)).toBe("signed-in");
  });

  it("fails the sign-in with the vendor's words when the vendor refuses it", async () => {
    const harness = await bootSignIn("code");
    const { pending } = await waitingForCode(harness);

    await harness.client.agents.submitSignInCode({ code: "stale#code", id: "claude" });
    expect(await pending).toMatchObject({
      detail: "Claude could not finish signing in: Login failed: Invalid authorization code",
      outcome: "failed",
    });
  });

  it("is refused CONFLICT when no sign-in is waiting for one", async () => {
    const harness = await bootSignIn("code");
    const [refusal] = await safe(
      harness.client.agents.submitSignInCode({ code: PAGE_CODE, id: "claude" }),
    );
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");
  });

  it("is refused CONFLICT for a sign-in that reads no code", async () => {
    const booted = await bootTestApp();
    const codex = booted.client.agents.signIn({ id: "codex" });
    await vi.waitFor(async () => {
      expect(await signingInOn(booted)).toEqual({ acceptsCode: false, authUrl: null, id: "codex" });
    });
    const [refusal] = await safe(
      booted.client.agents.submitSignInCode({ code: PAGE_CODE, id: "codex" }),
    );
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");
    await booted.client.agents.cancelSignIn({ id: "codex" });
    expect(await outcomeOf(codex)).toBe("cancelled");
  });

  it("never carries a second line to the vendor", async () => {
    const booted = await bootTestApp();
    const [refusal] = await safe(
      booted.client.agents.submitSignInCode({ code: `${PAGE_CODE}\nmore#lines`, id: "claude" }),
    );
    expect(refusal).toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("signing codex in", () => {
  it("asks its adapter to authenticate, and the vendor then answers signed in", async () => {
    const harness = await bootSignIn();
    const answer = await harness.client.agents.signIn({ id: "codex" });
    expect(answer.outcome).toBe("signed-in");
    expect(accountOf(answer.status, "codex")).toMatchObject({
      account: { label: "ChatGPT", state: "signed-in" },
    });
    // nothing was chosen and claude, the default a new thread would start on, is signed out.
    expect(answer.status.defaultId).toBe("codex");
  });
});

describe("a sign-in the server cannot run", () => {
  it("is refused NOT_FOUND for a harness that does not exist", async () => {
    const booted = await bootTestApp();
    const [refusal] = await safe(booted.client.agents.signIn({ id: "gemini" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("NOT_FOUND");
  });

  it("is refused CONFLICT while another runs", async () => {
    const booted = await bootTestApp();
    const first = booted.client.agents.signIn({ id: "claude" });
    await vi.waitFor(async () => {
      expect(await signingInOn(booted)).toEqual({
        acceptsCode: true,
        authUrl: null,
        id: "claude",
      });
    });
    const [refusal] = await safe(booted.client.agents.signIn({ id: "claude" }));
    expect(isDefinedError(refusal) && refusal.code).toBe("CONFLICT");
    await booted.client.agents.cancelSignIn({ id: "claude" });
    expect(await outcomeOf(first)).toBe("cancelled");
  });

  it("is refused PROVIDER_UNAVAILABLE when this copy lacks the runtime", async () => {
    vi.stubEnv("CODEX_PATH", path.join(makeTempDir("agent-sign-in-missing-"), "codex"));
    try {
      const booted = await bootTestApp();
      const [refusal] = await safe(booted.client.agents.signIn({ id: "codex" }));
      expect(isDefinedError(refusal) && refusal.code).toBe("PROVIDER_UNAVAILABLE");
      expect(refusal?.message).toBe(
        "This copy of inteligir is missing its ChatGPT runtime — reinstall it",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
