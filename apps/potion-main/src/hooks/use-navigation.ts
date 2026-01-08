'use client';

import type { AppRoutes, ParamMap } from '.next/types/routes';

import type { Route } from 'next';

import { useParams, usePathname, useSearchParams } from 'next/navigation';

/** Get the current pathname as a typed route. */
export const useStaticRoute = <R extends Route = Route>() => usePathname() as R;

/** Get typed route parameters for a specific app route. */
export const useTParams = <AppRoute extends AppRoutes>() => {
  const params = useParams<ParamMap[AppRoute]>();

  return params;
};

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type NonEmptyParams<T> =
  T extends Record<string, string>
    ? keyof T extends never
      ? never
      : T
    : never;

type RoutesStartingWith<Route extends string> = {
  [K in keyof ParamMap]: K extends `${Route}${string}` ? K : never;
}[keyof ParamMap];

type IsExactRoute<Route extends string> = Route extends keyof ParamMap
  ? true
  : false;

type PrefixRoutesExcludingExact<Route extends string> = {
  [K in keyof ParamMap]: K extends `${Route}${string}`
    ? K extends Route
      ? never
      : K
    : never;
}[keyof ParamMap];

type UnifiedParamsForPrefix<Route extends string> =
  IsExactRoute<Route> extends true
    ? Route extends keyof ParamMap
      ? ParamMap[Route] &
          Partial<
            UnionToIntersection<
              NonEmptyParams<ParamMap[PrefixRoutesExcludingExact<Route>]>
            >
          >
      : never
    : Partial<
        UnionToIntersection<NonEmptyParams<ParamMap[RoutesStartingWith<Route>]>>
      >;

type UnifiedParams = Partial<
  UnionToIntersection<NonEmptyParams<ParamMap[keyof ParamMap]>>
>;

/**
 * Get unified route parameters for layout components.
 *
 * When called without a generic, returns all possible route parameters as
 * optional. When called with a route generic, returns:
 *
 * - Required parameters for exact route matches
 * - Optional parameters for routes that start with the same prefix
 *
 * Works best with unique parameter names across routes (e.g., userId vs id).
 *
 * @example
 *   ```tsx
 *   // Get all possible params as optional
 *   const params = useLayoutParams();
 *
 *   // Get typed params for user routes
 *   const params = useLayoutParams<'/users/[userId]'>();
 *   // Result: { userId: string; profileId?: string; ... }
 *   ```;
 */
export function useLayoutParams(): UnifiedParams;

export function useLayoutParams<
  Route extends string,
>(): UnifiedParamsForPrefix<Route>;

export function useLayoutParams() {
  const params = useTParams<AppRoutes>();

  return params as any;
}

export const useIsIframe = () => {
  const searchParams = useSearchParams();

  return searchParams.get('iframe') === 'true';
};
