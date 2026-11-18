import { setTimeout as delay } from "node:timers/promises";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

afterEach(cleanup);

configure({ asyncUtilTimeout: 10_000 });

const SONNER_UNMOUNT_MS = 250;

afterAll(async () => {
  if (toast.getHistory().length > 0) {
    await delay(SONNER_UNMOUNT_MS);
  }
});
