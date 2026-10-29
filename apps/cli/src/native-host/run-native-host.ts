// `inteligir native-host`: an adapter from the extension's /browser wire to /local, framed on
// stdin and stdout, that never touches the library itself (§8.4). Loaded only by its own leaf.
// Chrome reads every byte on stdout as a frame, so the host writes nothing else there, never
// through consola or console, and answers its exit code rather than a failure line.

import { homedir } from "node:os";
import type { Writable } from "node:stream";
import { DEV_NATIVE_HOST_NAME, EXTENSION_ORIGIN } from "@repo/contract/browser/extension-identity";
import type { BrowserHostReply } from "@repo/contract/browser/browser-wire";
import type { CliDeps } from "../context";
import { devLauncherPath, devLauncherScript, installNativeHost } from "../desktop/native-hosts";
import { writeLines } from "../output";
import { packageFile } from "../paths";
import { runtimeModeOf } from "../server/config";
import { resolveCheckoutRoot } from "../server/dev-instance";
import { encodeFrame, FrameTooLargeError, readFrames } from "./frames";
import { answerRequest, incomingOf, refusedReply } from "./host-requests";
import { openInteligir } from "./open-app";
import type { OpenApp } from "./open-app";
import { reachServer } from "./reach-server";

export interface NativeHostLeafArgs {
  install: boolean;
  origin?: string | undefined;
}

export interface NativeHostIo {
  input: AsyncIterable<Uint8Array>;
  output: Writable;
}

export interface NativeHostDeps extends Pick<CliDeps, "env" | "homeDir" | "resolveServer"> {
  openApp: OpenApp;
  // how long a save waits for an app it opened; the reach's own default unless a suite shortens it
  reachDeadlineMs?: number;
}

// resolved once the bytes are handed to the pipe: a pipe is asynchronous on macOS, and an exit
// before the callback would drop the reply
const writeFrame = async (output: Writable, reply: BrowserHostReply): Promise<void> => {
  let frame: Buffer;
  try {
    frame = encodeFrame(reply);
  } catch {
    frame = encodeFrame(refusedReply("failed", "The answer was bigger than a browser reads."));
  }
  const written: PromiseWithResolvers<void> = Promise.withResolvers();
  // a failed write is the stream's own error event: the peer that would read it is gone
  output.write(frame, () => {
    written.resolve();
  });
  await written.promise;
};

// Chrome names the extension that started the host as its first argument; only the one whose id
// the committed key derives may drive it, which the dev build and the store's unpacked build share
export const runNativeHost = async (
  io: NativeHostIo,
  origin: string | undefined,
  deps: NativeHostDeps,
): Promise<number> => {
  if (origin !== EXTENSION_ORIGIN) {
    return 1;
  }
  const reach = async () =>
    deps.reachDeadlineMs === undefined
      ? await reachServer(deps)
      : await reachServer(deps, deps.reachDeadlineMs);
  try {
    // one frame at a time, in order: the extension takes the first reply to each request
    for await (const event of readFrames(io.input)) {
      const incoming = incomingOf(event);
      const reply =
        incoming.kind === "refused"
          ? incoming.reply
          : await answerRequest(incoming.request, { openApp: deps.openApp, reach });
      await writeFrame(io.output, reply);
    }
  } catch (error) {
    if (error instanceof FrameTooLargeError) {
      // the stream cannot be read past a frame this size, so it is answered once and closed
      await writeFrame(io.output, refusedReply("too-large", error.message));
    }
    return 1;
  }
  return 0;
};

// a checkout's own door for the dev extension: the packaged app writes the store builds' at boot
const installForCheckout = (deps: CliDeps): number => {
  if (runtimeModeOf(deps.env) === "prod") {
    process.stderr.write(
      "`inteligir native-host --install` is for a checkout's dev extension; the Inteligir app writes its own at every launch.\n",
    );
    return 1;
  }
  const homeDir = deps.homeDir ?? homedir();
  const checkout = resolveCheckoutRoot();
  const result = installNativeHost({
    homeDir,
    hostName: DEV_NATIVE_HOST_NAME,
    launcher: {
      path: devLauncherPath(homeDir),
      script: devLauncherScript({
        checkout,
        cliBin: packageFile("bin/inteligir"),
        node: process.execPath,
      }),
    },
    platform: process.platform,
  });
  writeLines([
    `launcher: ${result.launcher} (runs ${checkout})`,
    ...(result.written.length === 0
      ? ["no browser folder found to write a manifest into; open Chrome once, then run this again"]
      : result.written.map((file) => `wrote ${file}`)),
    ...result.failed.map((failure) => `could not write ${failure.path}: ${failure.reason}`),
  ]);
  return result.failed.length === 0 ? 0 : 1;
};

export const runNativeHostLeaf = async (
  args: NativeHostLeafArgs,
  deps: CliDeps,
): Promise<number> =>
  args.install
    ? installForCheckout(deps)
    : await runNativeHost({ input: process.stdin, output: process.stdout }, args.origin, {
        env: deps.env,
        homeDir: deps.homeDir,
        openApp: openInteligir,
        resolveServer: deps.resolveServer,
      });
