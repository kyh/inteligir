// oxlint-disable-next-line require-await -- `async` is what turns work's throw into a rejection, work still run on the caller's tick
export const settle = async <T>(work: () => T) => work();
