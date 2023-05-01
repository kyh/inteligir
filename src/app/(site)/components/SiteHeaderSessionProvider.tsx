"use client";

import { useState } from "react";

import SiteHeader from "~/app/(site)/components/SiteHeader";
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
      <SiteHeader />
    </UserSessionContext.Provider>
  );
}

export default SiteHeaderSessionProvider;
