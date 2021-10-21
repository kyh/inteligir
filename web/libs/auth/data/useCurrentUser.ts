import { useQuery } from "react-query";
import { useRouter } from "next/router";
import { fetcher } from "@util/query";
import { authRoutes } from "@libs/auth/server/authConfig";

export const fetchCurrent = async () => {
  const current = await fetcher.get(authRoutes.current.replace("/api", ""));
  if (Object.keys(current).length) {
    return current;
  }
  return null;
};

export const useCurrentUser = ({
  required = false,
  redirectTo = "/login?error=SessionExpired",
  queryConfig = {} as any,
} = {}) => {
  const router = useRouter();
  const query = useQuery(["current-user"], fetchCurrent, {
    ...queryConfig,
    onSettled(data, error) {
      if (queryConfig.onSettled) queryConfig.onSettled(data, error);
      if (data || !required) return;
      router.push(redirectTo);
    },
  });
  return [query.data, query.status === "loading"];
};
