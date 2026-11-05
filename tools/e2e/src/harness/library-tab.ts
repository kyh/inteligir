// The library's page in a browser tab over a booted Worker: the account `signUp` makes, a device of
// its own signed in for a scenario to seed and read the library through `/v1` as an app does, and a
// browser signed in through the site's own sign-in, which comes back to `/library`. What the tab
// shows is the replica it pulled; what the cell holds is read through the device's client.

import type { V1Client } from "@repo/contract/cloud/v1";
import { pollUntil } from "./poll";
import type { OpenLibraryOptions, ScenarioBrowser } from "./agent-browser";
import { OWNER, signUp } from "./cloud-account";
import type { CloudWorker, LaunchCloudWorkerArgs } from "./cloud-worker";
import type { ScenarioContext } from "./scenario";
import { uploadFile, v1Client } from "./v1-wire";

const DEADLINE_MS = 30_000;

export type Library = V1Client["library"];

export interface LibraryTab {
  readonly worker: CloudWorker;
  readonly browser: ScenarioBrowser;
  // the device's own client, the scenario's oracle for what the cell holds
  readonly library: Library;
  readonly account: V1Client["account"];
}

// a file's bytes sent to the library's store as the seeding device, answering their sha
type UploadBytes = (file: {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
}) => Promise<string>;

export interface LibraryTabOptions {
  readonly worker?: Pick<LaunchCloudWorkerArgs, "json" | "vars">;
  // what the library holds before the tab opens, so its first pull carries it
  readonly seed?: (library: Library, upload: UploadBytes) => Promise<void>;
  // under /library, its query included, read once the seed ran so it can name what the seed made
  readonly path?: () => string;
  // what the page shows once it is ready: its rail, unless this names the editor instead
  readonly ready?: string;
}

export const openLibraryTab = async (
  ctx: ScenarioContext,
  label: string,
  options: LibraryTabOptions = {},
): Promise<LibraryTab> => {
  const worker = await ctx.cloudWorker(options.worker);
  await signUp(worker.origin);
  const device = await v1Client(worker, null).account.signIn({
    ...OWNER,
    deviceName: "E2E Seeder",
  });
  const { account, library } = v1Client(worker, device.credential);
  await options.seed?.(library, async (file) => {
    const { sha, status } = await uploadFile(worker, device.credential, file);
    if (status !== 201) {
      throw new Error(`the seed's upload answered ${String(status)}`);
    }
    return sha;
  });
  const browser = await ctx.browser(label);
  const open: OpenLibraryOptions = {};
  if (options.path !== undefined) {
    open.path = options.path();
  }
  if (options.ready !== undefined) {
    open.ready = options.ready;
  }
  await browser.openLibrary(worker, open);
  return { account, browser, library, worker };
};

// an item's markdown as the cell holds it, once it holds what `holds` waits for
export const untilItemText = async (
  library: Library,
  id: string,
  holds: (markdown: string) => boolean,
  what: string,
): Promise<string> =>
  await pollUntil(
    async () => {
      const read = await library.items.read({ id });
      return read.view.markdown;
    },
    holds,
    { deadlineMs: DEADLINE_MS, describe: (markdown) => `${what}; the cell holds:\n${markdown}` },
  );
