"use client";

import { useState } from "react";

import { TopNavigation } from "./TopNavigation";
import UserSessionContext from "~/core/session/contexts/user-session";
import UserSession from "~/core/session/types/user-session";

type Data = {
  role: UserSession["role"];
  auth: UserSession["auth"];
  data: UserSession["data"];
};

function SiteHeaderSessionProvider(
  props: React.PropsWithChildren<{
    data: Data;
  }>
) {
  const [userSession, setUserSession] = useState<Maybe<Data>>(props.data);

  return (
    <UserSessionContext.Provider value={{ userSession, setUserSession }}>
      <TopNavigation />
    </UserSessionContext.Provider>
  );
}

export default SiteHeaderSessionProvider;
