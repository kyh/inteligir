import { createContext, use, useSyncExternalStore } from "react";
import type { AppRuntime } from "./compose-runtime";

export const RuntimeContext = createContext<AppRuntime | null>(null);

export const useRuntime = () => {
  const runtime = use(RuntimeContext);

  if (runtime === null) {
    throw new Error("a screen mounted outside the app's runtime");
  }

  return runtime;
};

export const useSession = () => {
  const { session } = useRuntime();

  return useSyncExternalStore(session.subscribe, session.get);
};

export const useLoginState = () => {
  const { login } = useRuntime();

  return useSyncExternalStore(login.subscribe, login.get);
};
