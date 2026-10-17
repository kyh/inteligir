// `inteligir native-host`: an adapter from the extension's /browser wire to /local, framed on
// stdin and stdout, that never touches the library itself (§8.4). Loaded only by its own leaf.

import type { CliDeps } from "../context";

export interface NativeHostLeafArgs {
  install: boolean;
  origin?: string | undefined;
}

// PIVOT-STUB(X): replaced by the origin check, the frame loop and --install (§8.4); reads nothing
export const runNativeHostLeaf = (_args: NativeHostLeafArgs, _deps: CliDeps): Promise<number> =>
  Promise.resolve(1);
