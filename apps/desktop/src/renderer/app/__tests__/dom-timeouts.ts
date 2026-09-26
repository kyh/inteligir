import { setTimeout as delay } from "node:timers/promises";
import { toast } from "@repo/ui/components/sonner";
import { configure } from "@testing-library/react";
import { afterAll } from "vitest";

// a three-core CI runner running four suites at once misses testing-library's one-second default
// on work a laptop finishes in a tenth of it; the booted suites also cross a real server per wait.
configure({ asyncUtilTimeout: 5000 });

// sonner unmounts a dismissed toast on a timer of its own (TIME_BEFORE_UNMOUNT, 200ms); one set by
// a file's last test fires after jsdom is gone, so a file that showed a toast waits it out.
const SONNER_UNMOUNT_MS = 250;

afterAll(async () => {
  if (toast.getHistory().length > 0) {
    await delay(SONNER_UNMOUNT_MS);
  }
});
