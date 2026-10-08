// reachable from the renderer's suites through `inteligir/server/testing`, so everything imported
// here compiles under the browser tsconfig: the cloud socket opener and the agent driver are
// injected (`cloudTransport`, `driver`) rather than imported, and serve.ts supplies the real ones.

import { closeConnection, createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { getSchemaVersion } from "@repo/db/meta";
import { runMigrations } from "@repo/db/migrate";
import { resolveMigrationsFolder } from "../paths";
import type { ResolvedAgentDriver } from "./agents/agent-driver";
import { createBrowserSession } from "./browser-session";
import { CloudPrefsStore } from "./cloud/cloud-prefs-store";
import { createCloudRuntime } from "./cloud/sync-runtime";
import type { CloudRuntimeArgs, CloudTransport } from "./cloud/sync-runtime";
import type { AppConfig } from "./config";
import { debugLog } from "./debug-log";
import { readMachineName } from "./device-name";
import type { AppContext } from "./orpc";
import { teardownStep } from "./shutdown";
import type { ShutdownStep, TeardownStepName } from "./shutdown";
import { ThreadService } from "./threads/service";
import { WsBus } from "./ws-bus";

// unshift: the listener must close its sockets before any service behind it.
export const registerListener = (teardown: ShutdownStep[], run: ShutdownStep["run"]): void => {
  teardown.unshift(teardownStep("listener", run));
};

// push: whenever it is registered, the data dir is released only after the db behind it closes.
export const registerLockRelease = (teardown: ShutdownStep[], run: ShutdownStep["run"]): void => {
  teardown.push(teardownStep("lock", run));
};

interface ComposeDriverDeps {
  config: AppConfig;
  db: DbConnection;
  bus: WsBus;
}

interface ComposePorts {
  // what this device is called before any sign-in names it; unset, the machine's own name.
  machineName?: string;
}

export interface ComposeRuntimeArgs {
  config: AppConfig;
  version: string;
  // whether the app will answer a browser with the workspace; the caller resolved its UI dir.
  servesUi: boolean;
  // required, not defaulted: a silent default is an agent that is off.
  driver: (deps: ComposeDriverDeps) => ResolvedAgentDriver;
  cloudTransport?: CloudTransport;
  // passed in live so the caller can install its shutdown handlers before composing:
  // a ^C during a slow first boot then tears down what already exists.
  teardown?: ShutdownStep[];
  ports?: ComposePorts;
}

export interface ComposedRuntime {
  context: AppContext;
  bus: WsBus;
  db: DbConnection;
  // each step is unshifted as its resource comes up, so a boot that throws (EADDRINUSE with the
  // db open) is still torn down by the caller.
  teardown: ShutdownStep[];
}

export const composeRuntime = async (args: ComposeRuntimeArgs): Promise<ComposedRuntime> => {
  const { config } = args;
  const ports = args.ports ?? {};
  const teardown = args.teardown ?? [];
  const register = (name: TeardownStepName, run: ShutdownStep["run"]): void => {
    teardown.unshift(teardownStep(name, run));
  };

  const db = createConnection(config.databasePath);
  register("db", () => {
    closeConnection(db);
  });
  const schemaVersion = getSchemaVersion(db, runMigrations(db, resolveMigrationsFolder()));

  const bus = new WsBus();
  const machineName = ports.machineName ?? (await readMachineName());

  const agentDriver = args.driver({ bus, config, db });
  register("agent", async () => {
    await agentDriver.dispose();
  });

  // before the thread service, which takes the outbox hook at construction; attach() closes the other direction.
  const cloudPrefs = new CloudPrefsStore(config.dataDir);
  const cloudArgs: CloudRuntimeArgs = {
    build: args.version,
    cloudUrl: config.cloudUrl,
    dataDir: config.dataDir,
    db,
    debugLog: debugLog(config.debug, "sync"),
    machineName,
    // the renderer's sync row subscribes to the `sync` target, so the status rides its one kind.
    onStatusChanged: () => {
      bus.notifySync(["sync-status-changed"]);
    },
    phoneRequests: () => cloudPrefs.phoneRequests(),
  };
  if (args.cloudTransport !== undefined) {
    cloudArgs.transport = args.cloudTransport;
  }
  const cloud = createCloudRuntime(cloudArgs);
  register("cloud", async () => {
    await cloud.dispose();
  });
  // an approval is raised by the turn's driver (parked on `agents/interaction-waiters`) and settled
  // by the thread service or its turn's end; the bus hears every one of them, so a phone-started
  // turn's reaches the phone whoever wrote it. a disposed runtime schedules nothing, so the
  // listener outlives it harmlessly.
  bus.onThreadChange((_threadId, changes) => {
    if (changes.includes("interactions-changed")) {
      cloud.approvalsChanged();
    }
  });
  const threads = new ThreadService({
    createTurnDriver: agentDriver.createTurnDriver,
    db,
    notifier: bus,
    sync: cloud,
  });
  // crash recovery writes (settles turns, frees claims, enqueues), so it runs in boot order, not in the constructor.
  threads.boot();
  cloud.attach(threads);

  // last, once every service it announces through exists; the bus has no clients before a socket is injected.
  cloud.start();

  const context: AppContext = {
    browserSession: createBrowserSession(),
    cloud,
    cloudPrefs,
    system: {
      agent: agentDriver.status,
      dataDir: config.dataDir,
      schemaVersion,
      servesUi: args.servesUi,
      startedAt: Date.now(),
      version: args.version,
    },
    threads,
  };

  return { bus, context, db, teardown };
};
