import { ORPCError } from "@orpc/server";
import { base } from "../orpc";
import { VendorMcpError } from "./vendor-mcp-config";
import type { VendorMcpRefusal } from "./vendor-mcp-config";

const CONNECTOR_REFUSALS = {
  "already-exists": "ALREADY_EXISTS",
  "not-a-url": "BAD_REQUEST",
  "not-found": "NOT_FOUND",
  unavailable: "PROVIDER_UNAVAILABLE",
} as const satisfies Record<VendorMcpRefusal, string>;

// only the kinds the contract row declares are translated; any other refusal stays a 500 rather
// than defaulting into a class the row does not declare.
const refusing = async <T>(
  declared: readonly VendorMcpRefusal[],
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VendorMcpError && declared.includes(error.kind)) {
      throw new ORPCError(CONNECTOR_REFUSALS[error.kind], { message: error.message });
    }
    throw error;
  }
};

const list = base.connectors.list.handler(
  async ({ context }) =>
    await refusing(["unavailable"], async () => await context.connectors.list()),
);

const add = base.connectors.add.handler(
  async ({ context, input }) =>
    await refusing(
      ["already-exists", "unavailable"],
      async () => await context.connectors.add(input),
    ),
);

const remove = base.connectors.remove.handler(
  async ({ context, input }) =>
    await refusing(
      ["not-found", "unavailable"],
      async () => await context.connectors.remove(input.name),
    ),
);

const signIn = base.connectors.signIn.handler(
  async ({ context, input }) =>
    await refusing(
      ["not-a-url", "not-found", "unavailable"],
      async () => await context.connectors.signIn(input.name),
    ),
);

export const connectorsRouter = {
  add,
  list,
  remove,
  signIn,
};
