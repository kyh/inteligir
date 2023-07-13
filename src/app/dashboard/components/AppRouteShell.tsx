"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { setCookie } from "~/core/generic/cookies";
import useCollapsible from "~/core/hooks/use-sidebar-state";
import UserSessionContext from "~/core/session/contexts/user-session";
import UserData from "~/core/session/types/user-data";
import UserSession from "~/core/session/types/user-session";
import CsrfTokenContext from "~/lib/contexts/csrf";
import OrganizationContext from "~/lib/contexts/organization";
import MembershipRole from "~/lib/organizations/types/membership-role";
import Organization from "~/lib/organizations/types/organization";
import { Toaster } from "~/components/Toaster";
import AppSidebar from "./AppSidebar";
import AuthChangeListener from "./AuthChangeListener";

type Data = {
  accessToken: Maybe<string>;
  language?: string;
  csrfToken: string | null;
  session: Session;
  user: UserData | null;
  organization: Maybe<Organization>;
  role: Maybe<MembershipRole>;
  ui: {
    sidebarState?: string;
    theme?: string;
  };
};

const RouteShell: React.FCC<{
  data: Data;
}> = ({ data, children }) => {
  const userSessionContext: UserSession = useMemo(() => {
    return {
      auth: data.session,
      data: data.user ?? undefined,
      role: data.role,
    };
  }, [data]);

  const [organization, setOrganization] = useState<Maybe<Organization>>(
    data.organization
  );

  const [userSession, setUserSession] =
    useState<Maybe<UserSession>>(userSessionContext);

  const updateCurrentOrganization = useCallback(() => {
    setOrganization(data.organization);

    const organizationId = data.organization?.uuid;

    if (organizationId) {
      setCookie("organizationId", organizationId.toString());
    }
  }, [data.organization]);

  const updateCurrentUser = useCallback(() => {
    if (userSessionContext.auth) {
      setUserSession(userSessionContext);
    }
  }, [userSessionContext]);

  useEffect(updateCurrentOrganization, [updateCurrentOrganization]);
  useEffect(updateCurrentUser, [updateCurrentUser]);

  return (
    <UserSessionContext.Provider value={{ userSession, setUserSession }}>
      <OrganizationContext.Provider value={{ organization, setOrganization }}>
        <CsrfTokenContext.Provider value={data.csrfToken}>
          <AuthChangeListener accessToken={data.accessToken} whenSignedOut="/">
            <Toaster />
            <RouteShellWithSidebar organizationUuid={organization?.uuid ?? ""}>
              {children}
            </RouteShellWithSidebar>
          </AuthChangeListener>
        </CsrfTokenContext.Provider>
      </OrganizationContext.Provider>
    </UserSessionContext.Provider>
  );
};

export default RouteShell;

function RouteShellWithSidebar(
  props: React.PropsWithChildren<{
    organizationUuid: string;
  }>
) {
  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <AppSidebar organizationUuid={props.organizationUuid} />
      <div className="relative mx-auto h-screen w-full overflow-y-auto">
        <main>{props.children}</main>
      </div>
    </div>
  );
}
