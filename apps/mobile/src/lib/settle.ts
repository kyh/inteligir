// a synchronous platform call answered as an async port's promise: a throw becomes a rejection,
// never an exception on the caller's stack
export const settle = <T>(work: () => T): Promise<T> => {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
};
