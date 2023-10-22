import { createContext, useContext } from "react";
import type { UserData } from "@/features/users/user-data";
import type { MembershipRole } from "@/features/organizations/membership-role";

/**
 * This interface combines the user's metadata from
 * Supabase Auth and the user's record in Database
 */
export type UserSession = {
  auth?: {
    accessToken: Maybe<string>;
    user: {
      id: string;
      email: Maybe<string>;
      phone: Maybe<string>;
    };
  };
  data: Maybe<UserData>;
  role: Maybe<MembershipRole>;
};

export const UserSessionContext = createContext<{
  userSession: Maybe<UserSession>;
  setUserSession: React.Dispatch<React.SetStateAction<Maybe<UserSession>>>;
}>({
  userSession: undefined,
  setUserSession: (_) => _,
});

export const useSessionContext = () => {
  return useContext(UserSessionContext);
};

export const useUserSession = () => {
  const { userSession } = useContext(UserSessionContext);

  return userSession;
};
