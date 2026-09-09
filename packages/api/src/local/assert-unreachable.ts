// the `never` parameter is the point: a union member left unhandled fails to compile here rather
// than falling through a switch at runtime
export const assertUnreachable: (value: never) => never = (value) => {
  throw new Error(`Unreachable case: ${String(value)}`);
};
