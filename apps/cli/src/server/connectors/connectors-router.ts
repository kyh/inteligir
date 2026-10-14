import { base } from "../orpc";
import { VendorMcpError } from "./vendor-mcp-config";
import type { VendorMcpRefusal } from "./vendor-mcp-config";

// a kind the route's map leaves out is rethrown as it came: a 500, never a class its row does not
// declare.
const refusing = async <T>(
  work: () => Promise<T>,
  byKind: Partial<Record<VendorMcpRefusal, (options: { message: string }) => Error>>,
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VendorMcpError) {
      const refuse = byKind[error.kind];
      if (refuse !== undefined) {
        throw refuse({ message: error.message });
      }
    }
    throw error;
  }
};

const list = base.connectors.list.handler(
  async ({ context, errors }) =>
    await refusing(async () => await context.connectors.list(), {
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

const add = base.connectors.add.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => await context.connectors.add(input), {
      "already-exists": errors.ALREADY_EXISTS,
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

const remove = base.connectors.remove.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => await context.connectors.remove(input.name), {
      "not-found": errors.NOT_FOUND,
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

const signIn = base.connectors.signIn.handler(
  async ({ context, input, errors }) =>
    await refusing(async () => await context.connectors.signIn(input.name), {
      "not-a-url": errors.BAD_REQUEST,
      "not-found": errors.NOT_FOUND,
      unavailable: errors.PROVIDER_UNAVAILABLE,
    }),
);

export const connectorsRouter = {
  add,
  list,
  remove,
  signIn,
};
