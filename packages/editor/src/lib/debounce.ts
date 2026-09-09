export interface Debouncer {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
}

export const createDebouncer = (fn: () => void, delayMs: number): Debouncer => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    cancel(): void {
      clear();
    },
    flush(): void {
      if (timer === null) {
        return;
      }
      clear();
      fn();
    },
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
  };
};
