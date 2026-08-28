// The composer suites boot the REAL thread stack through the shared
// `bootTestApp` graph and drive it over the typed client, so every send here
// is proven against the server's own lifecycle transitions rather than a mock
// of them. Only the fake provider is this file's own.

import {
  bootTestApp,
  FakeTurnDriver,
  type BootedTestApp,
  type FakeTurnDriverOptions,
} from "inteligir/server/testing";

export interface ThreadHarness extends BootedTestApp {
  driver: FakeTurnDriver;
}

export async function bootThreadHarness(options: FakeTurnDriverOptions): Promise<ThreadHarness> {
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
