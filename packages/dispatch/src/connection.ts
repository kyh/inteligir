/** Symbol-based connection attempt cancellation (inspired by t3code). */
export function createConnectionAttemptRegistry() {
  const attempts = new Map<string, symbol>();
  return {
    begin(key: string) {
      const id = Symbol(key);
      attempts.set(key, id);
      return { key, isCurrent: () => attempts.get(key) === id };
    },
    cancel(key: string) {
      attempts.delete(key);
    },
  };
}

export type ConnectionAttempt = ReturnType<
  ReturnType<typeof createConnectionAttemptRegistry>["begin"]
>;
