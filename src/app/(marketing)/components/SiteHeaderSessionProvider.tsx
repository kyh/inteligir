"use client";

import { useState } from "react";
import UserSessionContext from "~/core/session/contexts/user-session";
import UserSession from "~/core/session/types/user-session";
import { TopNavigation } from "./TopNavigation";

type Session = {
  role: UserSession["role"];
  auth: UserSession["auth"];
  data: UserSession["data"];
};

function SiteHeaderSessionProvider(
  props: React.PropsWithChildren<{
    data: Maybe<Session>;
  }>
) {
  const [userSession, setUserSession] = useState(props.data);

  return (
    <UserSessionContext.Provider value={{ userSession, setUserSession }}>
      <TopNavigation />
    </UserSessionContext.Provider>
  );
}

export default SiteHeaderSessionProvider;
