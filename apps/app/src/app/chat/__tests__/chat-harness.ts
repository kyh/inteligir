// The composer suites boot the REAL thread stack through the shared
// `bootTestApp` graph and drive it over the typed client, so every send here
// is proven against the server's own lifecycle transitions rather than a mock
// of them. Only the fake provider is this file's own.

import { bootTestApp, type BootedTestApp } from "../../../node/__tests__/boot-app";
import {
  FakeTurnDriver,
  type FakeTurnDriverOptions,
} from "../../../node/__tests__/fake-turn-driver";

export interface ChatHarness extends BootedTestApp {
  driver: FakeTurnDriver;
}

export async function bootChatHarness(options: FakeTurnDriverOptions): Promise<ChatHarness> {
  let driver: FakeTurnDriver | null = null;
  const booted = await bootTestApp({
    makeDriver: () => ({
      createTurnDriver: (sink) => {
        driver = new FakeTurnDriver(sink, options);
        return driver;
      },
    }),
  });
  if (driver === null) {
    throw new Error("the driver was not constructed");
  }
  return { ...booted, driver };
}
