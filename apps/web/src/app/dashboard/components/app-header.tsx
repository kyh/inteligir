"use client";

import Heading from "@inteligir/ui/heading";
import ProfileDropdown from "@/components/profile-dropdown";
import MobileNavigation from "@/components/mobile-navigation";
import useSignOut from "@/features/auth/use-sign-out";
import OrganizationsSelector from "@/app/dashboard/components/organizations-selector";
import HeaderSubscriptionStatusBadge from "@/app/dashboard/components/header-subscription-status-badge";
import { If } from "@/components/if";
import AppContainer from "./app-container";
import useUserSession from "@/features/user/use-user-session";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";

const AppHeader: React.FCC<{
  Icon?: React.ReactNode;
}> = ({ children, Icon }) => {
  const userSession = useUserSession();
  const signOut = useSignOut();
  const currentOrganization = useCurrentOrganization();

  return (
    <div className="dark:border-dark-800 flex items-center justify-between border-b border-gray-50">
      <AppContainer>
        <div className="flex w-full flex-1 justify-between">
          <div className="flex items-center justify-between space-x-2.5 lg:space-x-0">
            <div className="flex items-center lg:hidden">
              <If condition={currentOrganization?.uuid}>
                {(uid) => <MobileNavigation organizationUid={uid} />}
              </If>
            </div>

            <div className="flex items-center space-x-2 lg:space-x-4">
              <div>
                <OrganizationsSelector />
              </div>

              <Heading type={5}>
                <span className="flex items-center space-x-0.5 lg:space-x-2">
                  {Icon}

                  <span className="lg:text-initial text-base font-medium dark:text-white">
                    {children}
                  </span>
                </span>
              </Heading>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden items-center md:flex">
              <HeaderSubscriptionStatusBadge />
            </div>

            <ProfileDropdown
              signOutRequested={signOut}
              userSession={userSession}
            />
          </div>
        </div>
      </AppContainer>
    </div>
  );
};

export default AppHeader;
