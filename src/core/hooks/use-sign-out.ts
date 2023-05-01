import { useCallback, useContext } from "react";
import useSupabase from "~/core/hooks/use-supabase";
import UserSessionContext from "~/core/session/contexts/user-session";

/**
 * @name useSignOut
 */
function useSignOut() {
  const { setUserSession } = useContext(UserSessionContext);
  const client = useSupabase();

  return useCallback(async () => {
    await client.auth.signOut();
    setUserSession(undefined);
  }, [client.auth, setUserSession]);
}

export default useSignOut;
