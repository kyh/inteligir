import { useContext } from "react";
import UserSessionContext from "~/core/session/contexts/user-session";

const useUserSession = () => {
  const { userSession } = useContext(UserSessionContext);

  return userSession;
};

export default useUserSession;
