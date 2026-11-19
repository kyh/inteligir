import { setTimeout as delay } from "node:timers/promises";
import { toast } from "@repo/ui/components/sonner";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

// Nothing turns on vitest's `globals`, so Testing Library never registers its own auto-cleanup and
// a rendered tree stays mounted past its case.
afterEach(cleanup);

// a CI runner running four suites at once misses testing-library's one-second default on work a
// laptop finishes in a tenth of it; the booted suites also cross a real server per wait. A wait
// that holds returns at once, so only a failing one pays for the margin.
configure({ asyncUtilTimeout: 10_000 });

// sonner unmounts a dismissed toast on a timer of its own (TIME_BEFORE_UNMOUNT, 200ms); one set by
// a file's last test fires after jsdom is gone, so a file that showed a toast waits it out.
const SONNER_UNMOUNT_MS = 250;

afterAll(async () => {
  // TanStack Query hands a screen a read's answer on a 0ms timer, and one a file's last test queued
  // before its tree unmounted would reach React after jsdom is gone; timers of one length fire in
  // the order they were set, so one more turn of them lets every such answer land first
  await delay(0);
  if (toast.getHistory().length > 0) {
    await delay(SONNER_UNMOUNT_MS);
  }
});
