import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { createKeychainCredentials } from "../credential/secure-store-credential";
import { threadDispatches, threadListEntries } from "../dispatch/dispatch-projection";
import type { ThreadDispatches, ThreadListEntry } from "../dispatch/dispatch-projection";
import type {
  AskAgentRequest,
  CancelOutcome,
  DispatchOutcome,
  DispatchState,
} from "../dispatch/dispatch-runtime";
import type { LoginRequest, LoginState } from "../login/login-store";
import type { LiveItem } from "../sync/live-turns";
import { rnSocketDial } from "../sync/rn-socket-dial";
import type { SyncStatus } from "../sync/sync-runtime";
import { liveThreadsFirst, projectThread } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
import { hexFromBytes } from "@repo/contract/cloud/bytes";
import { createCloudSocketOpener } from "@repo/contract/cloud/sync/cloud-socket";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime, LogoutOutcome } from "./compose-runtime";
import { createExpoSqlDriver } from "./expo-sql-driver";

let runtime: AppRuntime | null = null;

// console.warn would raise a LogBox toast per skipped row or offline pass.
const devLog = (message: string): void => {
  if (__DEV__) {
    console.log(`sync: ${message}`);
  }
};

const build = (): AppRuntime => {
  const rt = composeRuntime({
    cloudUrl: getCloudUrl(),
    credentials: createKeychainCredentials(SecureStore),
    db: createExpoSqlDriver("inteligir.db"),
    mintId: () => hexFromBytes(Crypto.getRandomBytes(16)),
    sha1: async (bytes) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, bytes)),
    sync: { onDebug: devLog, openSocket: createCloudSocketOpener(rnSocketDial) },
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  // `inactive` is a passing state on iOS (a pulled-down notification centre), not a departure.
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      rt.resume();
    } else if (state === "background") {
      rt.suspend();
    }
  });
  // a phone back online sends what it asked offline without waiting for the retry timer; in the
  // background it waits for the foreground, which reopens the socket too
  let online = true;
  addNetworkStateListener((network) => {
    const reachable = network.isInternetReachable ?? network.isConnected ?? false;
    if (reachable && !online && AppState.currentState === "active") {
      rt.resume();
    }
    online = reachable;
  });
  return rt;
};

const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  await getRuntime().start();
};

export const syncNow = async (): Promise<void> => {
  await getRuntime().sync.syncNow();
};

export const logout = async (options?: { discardUnsent?: boolean }): Promise<LogoutOutcome> =>
  await getRuntime().logout(options);

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

export const useSyncStatus = (): SyncStatus => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};

const useDispatchState = (): DispatchState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.dispatch.subscribe, rt.dispatch.get);
};

// the synced threads and those that so far exist only on this phone, each with what it is doing
export const useThreadList = (): readonly ThreadListEntry[] => {
  const rt = getRuntime();
  const threads = useSyncExternalStore(rt.store.subscribeThreads, rt.store.snapshotThreads);
  const dispatches = useDispatchState();
  return useMemo(
    () =>
      threadListEntries(
        liveThreadsFirst(threads.map((thread) => projectThread(thread))),
        dispatches,
      ),
    [threads, dispatches],
  );
};

export const useThread = (threadId: string): ThreadProjection | null => {
  const rt = getRuntime();
  const thread = useSyncExternalStore(rt.store.subscribeThreads, () =>
    rt.store.snapshotThread(threadId),
  );
  return useMemo(() => (thread === null ? null : projectThread(thread)), [thread]);
};

// what the thread's running turn has streamed so far, cleared as its items settle
export const useLiveItems = (threadId: string): readonly LiveItem[] => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.live.subscribe, () => rt.live.snapshot(threadId));
};

export const useDispatches = (threadId: string): ThreadDispatches => {
  const thread = useThread(threadId);
  const dispatches = useDispatchState();
  return useMemo(
    () => threadDispatches(threadId, thread, dispatches),
    [threadId, thread, dispatches],
  );
};

export const askAgent = async (request: AskAgentRequest): Promise<DispatchOutcome> =>
  await getRuntime().dispatch.askAgent(request);

export const answerApproval = async (
  approvalId: string,
  decision: PendingInteractionApprovalDecision,
): Promise<DispatchOutcome> => await getRuntime().dispatch.answer(approvalId, decision);

export const cancelDispatch = async (id: string): Promise<CancelOutcome> =>
  await getRuntime().dispatch.cancel(id);

export const dismissDispatch = async (id: string): Promise<void> => {
  await getRuntime().dispatch.dismiss(id);
};
