export type Debouncer = {
  schedule(): void;
  flush(): void;
  cancel(): void;
};

export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    flush(): void {
      if (timer === null) return;
      clear();
      fn();
    },
    cancel(): void {
      clear();
    },
  };
}
