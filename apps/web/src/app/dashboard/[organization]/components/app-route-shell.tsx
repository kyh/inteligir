"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import OrganizationContext from "@/features/organizations/organization-provider";
import CsrfTokenContext from "@/lib/csrf/csrf-provider";
import SidebarContext from "@/lib/contexts/sidebar-provider";
import UserSessionContext from "@/features/auth/session-context";
import { setCookie } from "@/lib/utils/cookies";
import type loadAppData from "@/features/global/load-app-data";
import type UserSession from "@/features/user/user-session";
import useCollapsible from "@/lib/hooks/use-sidebar-state";
import AuthChangeListener from "@/components/auth-change-listener";
import type Organization from "@/lib/organizations/types/organization";
import SentryBrowserWrapper from "@/components/sentry-provider";
import Toaster from "@/components/toaster";
import AppSidebar from "@/app/dashboard/[organization]/components/app-sidebar";

const RouteShell: React.FCC<{
  data: Awaited<ReturnType<typeof loadAppData>>;
}> = ({ data, children }) => {
  const userSessionContext: UserSession = useMemo(() => {
    return {
      auth: data.auth,
      data: data.user ?? undefined,
      role: data.role,
    };
  }, [data]);

  const [organization, setOrganization] = useState<Maybe<Organization>>(
    data.organization,
  );

  const [userSession, setUserSession] =
    useState<Maybe<UserSession>>(userSessionContext);

  const updateCurrentOrganization = useCallback(() => {
    setOrganization(data.organization);

    const organizationId = data.organization?.uuid;
    const cookieName = `${userSession?.data?.id}-organizationId`;

    if (organizationId) {
      setCookie(cookieName, organizationId.toString());
    }
  }, [data.organization, userSession]);

  const updateCurrentUser = useCallback(() => {
    if (userSessionContext.auth) {
      setUserSession(userSessionContext);
    }
  }, [userSessionContext]);

  useEffect(updateCurrentOrganization, [updateCurrentOrganization]);
  useEffect(updateCurrentUser, [updateCurrentUser]);

  return (
    <SentryBrowserWrapper>
      <UserSessionContext.Provider value={{ userSession, setUserSession }}>
        <OrganizationContext.Provider value={{ organization, setOrganization }}>
          <CsrfTokenContext.Provider value={data.csrfToken}>
            <AuthChangeListener
              accessToken={data.auth.accessToken}
              whenSignedOut="/"
            >
              <main>
                <Toaster />

                <RouteShellWithSidebar
                  collapsed={data.ui.sidebarState === "collapsed"}
                  organization={organization?.uuid ?? ""}
                >
                  {children}
                </RouteShellWithSidebar>
              </main>
            </AuthChangeListener>
          </CsrfTokenContext.Provider>
        </OrganizationContext.Provider>
      </UserSessionContext.Provider>
    </SentryBrowserWrapper>
  );
};

export default RouteShell;

const RouteShellWithSidebar = (
  props: React.PropsWithChildren<{
    collapsed: boolean;
    organization: string;
  }>,
) => {
  const [collapsed, setCollapsed] = useCollapsible(props.collapsed);

  return (
    <div className="flex overflow-hidden">
      <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
        <div className="hidden lg:block">
          <AppSidebar organizationUid={props.organization} />
        </div>

        <div className="relative mx-auto flex h-screen w-full flex-col overflow-y-auto">
          {props.children}
        </div>
      </SidebarContext.Provider>
    </div>
  );
};
