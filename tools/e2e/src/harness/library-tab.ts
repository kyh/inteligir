// The library's page in a browser tab over a booted Worker: the account `signUp` makes, its session
// called through the extension's door for a scenario to seed and read the library through `/v1` as
// an app does, and a browser signed in through the site's own sign-in, which comes back to the page.
// What the tab shows it read from the cell; what the cell holds is read through that client.

import type { V1Client } from "@repo/contract/v1";
import { pollUntil } from "./poll";
import type { OpenLibraryOptions, ScenarioBrowser } from "./agent-browser";
import { signUp } from "./cloud-account";
import type { CloudWorker, LaunchCloudWorkerArgs } from "./cloud-worker";
import type { ScenarioContext } from "./scenario";
import { asExtension, uploadFile, v1Client } from "./v1-wire";

const DEADLINE_MS = 30_000;

export type Library = V1Client["library"];

export interface LibraryTab {
  readonly worker: CloudWorker;
  readonly browser: ScenarioBrowser;
  // the sign-up session's own client, the scenario's oracle for what the cell holds
  readonly library: Library;
  readonly account: V1Client["account"];
}

// a file's bytes sent to the library's store as the seeding client, answering their sha
type UploadBytes = (file: {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
}) => Promise<string>;

export interface LibraryTabOptions {
  readonly worker?: Pick<LaunchCloudWorkerArgs, "json" | "vars">;
  // what the library holds before the tab opens, so its first read carries it
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
  const { cookie } = await signUp(worker.origin);
  const seeder = asExtension(cookie);
  const { account, library } = v1Client(worker, seeder);
  await options.seed?.(library, async (file) => {
    const { sha, status } = await uploadFile(worker, seeder, file);
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
