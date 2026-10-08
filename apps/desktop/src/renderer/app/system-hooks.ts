// The server's own facts: its version, the data dir it serves and the agent it runs.

import { useQuery } from "@tanstack/react-query";
import { orpc } from "./api";

// No change kind names this query, so it re-reads on every mount.
export const useSystemStatus = () =>
  useQuery({ ...orpc.system.status.queryOptions(), staleTime: 0 });
