import { useQuery } from "react-query";
import { useRouter } from "next/router";
import { fetcher } from "@util/query";

export const fetchSession = async () => {
  const session = await fetcher.get("/api/auth/session");
  if (Object.keys(session).length) {
    return session;
  }
  return null;
};

export const useSession = ({
  required = false,
  redirectTo = "/auth/login?error=SessionExpired",
  queryConfig = {} as any,
} = {}) => {
  const router = useRouter();
  const query = useQuery(["session"], fetchSession, {
    ...queryConfig,
    onSettled(data, error) {
      if (queryConfig.onSettled) queryConfig.onSettled(data, error);
      if (data || !required) return;
      router.push(redirectTo);
    },
  });
  return [query.data, query.status === "loading"];
};
