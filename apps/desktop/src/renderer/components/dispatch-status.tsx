import { useCallback, useEffect, useState } from "react";
import { SmartphoneIcon, RefreshCwIcon } from "lucide-react";

import type { DispatchState } from "@/shared/dispatch";
import { DISPATCH_INITIAL_STATE } from "@/shared/dispatch";
import { getBridge } from "@/renderer/lib/bridge";

export function DispatchStatus() {
  const [state, setState] = useState<DispatchState>(DISPATCH_INITIAL_STATE);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;

    void bridge.getDispatchState().then(setState);
    const unsub = bridge.onDispatchState((s) => setState(s as DispatchState));
    return unsub;
  }, []);

  const handleRefresh = useCallback(() => {
    void getBridge()?.refreshDispatchCode();
  }, []);

  if (state.status === "idle") return null;

  if (state.status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-400">
        <SmartphoneIcon className="size-3.5" />
        <span>Dispatch error: {state.error}</span>
        <button onClick={handleRefresh} className="ml-auto hover:text-red-300">
          <RefreshCwIcon className="size-3" />
        </button>
      </div>
    );
  }

  if (state.status === "awaiting_pair" || state.status === "reconnecting") {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2">
        <SmartphoneIcon className="size-4 text-neutral-400" />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-neutral-400">
            {state.status === "reconnecting" ? "Reconnecting..." : "Pair with mobile"}
          </span>
          <span className="font-mono text-lg font-bold tracking-[0.3em] text-white">
            {state.roomCode}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="ml-auto text-neutral-500 hover:text-neutral-300"
          title="New code"
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-green-400">
      <SmartphoneIcon className="size-3.5" />
      <span>Mobile connected</span>
    </div>
  );
}
