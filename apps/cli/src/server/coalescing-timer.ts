// one unref'd timeout, armed once: a trigger while it is armed folds into the pending fire
// rather than pushing it out, so a steady burst still fires at the first deadline.

export interface CoalescingTimer {
  arm(): void;
  clear(): void;
}

export function createCoalescingTimer(delayMs: number, fire: () => void): CoalescingTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    arm() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, delayMs);
      timer.unref?.();
    },
    clear() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
