"use client";

import type { Route } from "next";

import { useParams, usePathname, useSearchParams } from "next/navigation";

/** Get the current pathname as a typed route. */
export const useStaticRoute = <R extends Route = Route>() =>
  usePathname() as R;

/** Get typed route parameters for a specific app route. */
export const useTParams = <
  _AppRoute extends string = string,
>(): Record<string, string> => {
  const params = useParams();
  return params as Record<string, string>;
};

/** Get unified route parameters for layout components. */
export function useLayoutParams(): Record<string, string | undefined> {
  const params = useParams();
  return params as Record<string, string | undefined>;
}

export const useIsIframe = () => {
  const searchParams = useSearchParams();
  return searchParams.get("iframe") === "true";
};
