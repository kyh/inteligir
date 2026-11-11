// a synchronous platform call answered as an async port's promise: a throw becomes a rejection,
// never an exception on the caller's stack
// oxlint-disable-next-line require-await -- `async` is what turns work's throw into a rejection, work still run on the caller's tick
export const settle = async <T>(work: () => T): Promise<T> => work();
