import { useCallback, useState } from "react";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function useLogin() {
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const login = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    setLoggingIn(true);
    setLoginError(null);

    void bridge
      .login()
      .then((result) => {
        if (result.ok) {
          useAgentStore.getState().checkSetup();
          useAgentStore.getState().fetchState();
        } else {
          setLoginError(result.error);
        }
      })
      .catch(() => setLoginError("Login failed"))
      .finally(() => setLoggingIn(false));
  }, []);

  return { login, loggingIn, loginError } as const;
}
