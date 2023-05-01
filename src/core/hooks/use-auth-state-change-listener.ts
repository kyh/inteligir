import { useContext, useEffect } from "react";
import UserSessionContext from "~/core/session/contexts/user-session";
import useSupabase from "~/core/hooks/use-supabase";

function useAuthStateChangeListener() {
  const client = useSupabase();
  const { setUserSession } = useContext(UserSessionContext);

  useEffect(() => {
    const { data: listener } = client.auth.onAuthStateChange((_, session) => {
      setUserSession((userSession) => {
        if (!session) {
          return undefined;
        }

        return userSession
          ? { ...userSession, auth: session }
          : {
              role: undefined,
              data: undefined,
              auth: session,
            };
      });
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [client.auth, setUserSession]);
}

export default useAuthStateChangeListener;
