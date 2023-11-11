import { createTRPCReact } from "@trpc/react-query";

import type { AppRouter } from "@inteligir/api";

export const api = createTRPCReact<AppRouter>();

export { type RouterInputs, type RouterOutputs } from "@inteligir/api";
