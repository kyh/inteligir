import { useQueryClient, useQuery, useMutation } from "react-query";
import { fetcher } from "@util/query";
import { clientAuthRoutes } from "@libs/auth/server/authConfig";

// We should subset this to only interface we need.
import { User as PrismaUser } from "@prisma/client";
export type User = Pick<PrismaUser, "id" | "email" | "role">;

type AuthInput = { email: string; password: string };

const useHandleAuth = (shouldInvalidate = false) => {
  const queryClient = useQueryClient();

  const handleAuth = (user: User) => {
    queryClient.setQueryData("currentUser", user);
    if (shouldInvalidate) {
      queryClient.invalidateQueries();
    }
  };

  return handleAuth;
};

export const useCurrentUser = () => {
  const query = useQuery<User>(
    "currentUser",
    () => fetcher.get(clientAuthRoutes.current),
    {
      retry: false,
    }
  );

  return {
    isLoggedIn: query.data ? !!query.data.id : false,
    user: query.data && query.data.id ? query.data : null,
    ...query,
  };
};

export const useLogin = () => {
  const handleAuth = useHandleAuth();
  return useMutation(
    (data: AuthInput) => fetcher.post(clientAuthRoutes.login, data),
    {
      onSuccess: handleAuth,
    }
  );
};

export const useSignup = () => {
  const handleAuth = useHandleAuth();
  return useMutation(
    (data: AuthInput) => fetcher.post(clientAuthRoutes.signup, data),
    {
      onSuccess: handleAuth,
    }
  );
};

export const useLogout = () => {
  const handleAuth = useHandleAuth(true);
  return useMutation(() => fetcher.post(clientAuthRoutes.logout), {
    onSuccess: handleAuth,
  });
};
