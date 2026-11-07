export interface Debouncer {
  schedule: () => void;
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
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
  };
};
