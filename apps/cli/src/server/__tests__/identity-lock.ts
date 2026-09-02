// for suites where serialization is not under test; the service requires a lock so production cannot omit one.
export const identityLock = <T>(work: () => Promise<T>): Promise<T> => work();
