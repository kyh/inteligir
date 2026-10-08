// no middleware ladder: the token is checked at the http boundary, where the socket and the
// page it guards are not procedures.

import { localContract } from "@repo/contract/local";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";
import { implement } from "@orpc/server";
import type { BrowserSession } from "./browser-session";
import type { CloudPrefsStore } from "./cloud/cloud-prefs-store";
import type { CloudRuntime } from "./cloud/sync-runtime";
import type { ThreadService } from "./threads/service";

interface SystemFacts {
  version: string;
  dataDir: string;
  schemaVersion: number;
  startedAt: number;
  // false in a checkout whose UI was never built: no page answers a browser.
  servesUi: boolean;
  // read per request: a runtime that comes or goes is the next answer.
  agent: () => AgentStatus;
}

export interface AppContext {
  browserSession: BrowserSession;
  cloud: CloudRuntime;
  cloudPrefs: CloudPrefsStore;
  system: SystemFacts;
  threads: ThreadService;
}

export const base = implement(localContract).$context<AppContext>();
