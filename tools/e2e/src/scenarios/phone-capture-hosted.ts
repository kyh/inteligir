import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { loginDevice, signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { signInOwner } from "../harness/hosted-vault";
import { pollUntil } from "../harness/poll";
import { PHONE_NAME, phoneRuntime } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const INBOX = "Inbox.md";
const CAPTURED = "Call the framer about the north wall";
const BULLET = `- ${CAPTURED}`;
const DELIVERY_DEADLINE_MS = 30_000;

// the phase of the one capture the phone holds, or "none" once it let it go
const capturePhase = (phone: AppRuntime): string => {
  const captures = phone.dispatch.get().dispatches.filter((row) => row.kind === "capture");
  expect(captures.length <= 1, `the phone holds ${String(captures.length)} captures`);
  return captures[0]?.phase.kind ?? "none";
};

const inboxBullets = async (vaultDir: string): Promise<number> => {
  let content: string;
  try {
    content = await readFile(path.join(vaultDir, INBOX), "utf-8");
  } catch {
    return 0;
  }
  return content.split("\n").filter((line) => line === BULLET).length;
};

export const phoneCaptureHosted: Scenario = {
  description:
    "the phone's own runtime keeps a capture typed offline across a relaunch and sends it once online; A signs in later and writes it to `Inbox.md` exactly once, and the phone lets it go",
  name: "phone-capture-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; the phone signs in");
    await signUp(worker.origin);
    const login = await loginDevice(worker.origin, PHONE_NAME);
    const credential = { credential: login.credential, deviceId: login.deviceId };
    const dir = path.join(ctx.scratchDir, "phone");
    const network = { online: false };

    ctx.log("offline, the phone captures a line");
    const first = await phoneRuntime(worker.origin, dir, network, credential);
    await first.start();
    const kept = await first.dispatch.capture(CAPTURED);
    expect(kept.ok, `the phone refused the capture: ${kept.ok ? "" : kept.message}`);
    await first.dispatch.sendNow();
    expectEq(capturePhase(first), "unsent", "the capture typed offline");
    first.suspend();

    ctx.log("the phone relaunches online and sends what the last launch kept");
    network.online = true;
    const phone = await phoneRuntime(worker.origin, dir, network, credential);
    await phone.start();
    await phone.dispatch.sendNow();
    expectEq(capturePhase(phone), "waiting", "the capture with no Mac to claim it");

    ctx.log("A signs in, claims the capture and writes it to Inbox.md");
    const a = await ctx.boot({
      extraEnv: { INTELIGIR_AGENT: "scripted", INTELIGIR_CLOUD_URL: worker.origin },
      name: "a",
      vaultRemote: await ctx.bareRemote("a"),
    });
    await signInOwner(a, "A", "E2E Device A");
    await pollUntil(
      async () => {
        await a.api.cloud.syncNow();
        return await inboxBullets(a.vaultDir);
      },
      (bullets) => bullets > 0,
      { deadlineMs: DELIVERY_DEADLINE_MS, describe: () => `A's ${INBOX} never held the capture` },
    );

    ctx.log("more passes claim nothing more: the capture is written once");
    await a.api.cloud.syncNow();
    await a.api.cloud.syncNow();
    expectEq(await inboxBullets(a.vaultDir), 1, `the capture's bullets in A's ${INBOX}`);

    ctx.log("the phone hears a Mac wrote it and lets it go");
    await pollUntil(
      async () => {
        await phone.dispatch.sendNow();
        return capturePhase(phone);
      },
      (phase) => phase === "none",
      {
        deadlineMs: DELIVERY_DEADLINE_MS,
        describe: (phase) => `the phone still holds the capture as ${phase}`,
      },
    );
    phone.suspend();
  },
};
