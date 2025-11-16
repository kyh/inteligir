import type { AppRouter } from "./root-router";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { appRouter } from "./root-router";
import { createTRPCContext } from "./trpc";
import { auth, getOrganization, getSession } from "./auth/auth";
import { getAuthUser } from "./auth/get-auth-user";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: number }
 **/
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 **/
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { createTRPCContext, appRouter, auth, getSession, getOrganization, getAuthUser };
export type { AppRouter, RouterInputs, RouterOutputs };
export type { AuthUser } from "./auth/get-auth-user";
