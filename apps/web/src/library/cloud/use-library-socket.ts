// The account's socket (`@repo/client/library-cache`), dialled while the page shows the library and
// the browser says it is online: at once when it comes back rather than at the next wait of its
// backoff, and never while it is offline.

import type { AccountSocket } from "@repo/client/account-socket";
import { onlineManager } from "@tanstack/react-query";
import { useEffect } from "react";

export const useLibrarySocket = (socket: AccountSocket): void => {
  useEffect(() => {
    const reach = (online: boolean): void => {
      if (online) {
        socket.online();
      } else {
        socket.offline();
      }
    };
    reach(onlineManager.isOnline());
    socket.connect();
    const stop = onlineManager.subscribe(reach);
    return () => {
      stop();
      socket.close();
    };
  }, [socket]);
};
