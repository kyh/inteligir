"use client";

import React, { useMemo } from "react";

import NavigationItem from "~/core/ui/Navigation/NavigationItem";
import NavigationMenu from "~/core/ui/Navigation/NavigationMenu";
import useUser from "~/core/hooks/use-user";
import MobileNavigationDropdown from "~/core/ui/MobileNavigationDropdown";

const links = {
  General: {
    path: "/settings/profile",
    label: "profile:generalTab",
  },
  Authentication: {
    path: "/settings/profile/authentication",
    label: "profile:authenticationTab",
  },
  Email: {
    path: "/settings/profile/email",
    label: "profile:emailTab",
  },
  Password: {
    path: "/settings/profile/password",
    label: "profile:passwordTab",
  },
};

const ProfileSettingsTabs = () => {
  const { data: user } = useUser();

  // user can only edit email and password
  // if they signed up with the EmailAuthProvider provider
  const canEditEmailAndPassword = useMemo(() => {
    if (!user) {
      return false;
    }

    const emailProviderId = "email";
    const identities = user.identities ?? [];

    return identities.some((identity) => {
      return identity.provider === emailProviderId;
    });
  }, [user]);

  const itemClassName = `flex justify-center lg:justify-start items-center w-full`;

  return (
    <>
      <div className="hidden min-w-[12rem] lg:flex">
        <NavigationMenu vertical pill>
          <NavigationItem
            depth={0}
            className={itemClassName}
            link={links.General}
          />

          <NavigationItem
            className={itemClassName}
            link={links.Authentication}
          />

          <NavigationItem
            className={itemClassName}
            disabled={!canEditEmailAndPassword}
            link={links.Email}
          />

          <NavigationItem
            className={itemClassName}
            disabled={!canEditEmailAndPassword}
            link={links.Password}
          />
        </NavigationMenu>
      </div>

      <div className="block w-full lg:hidden">
        <MobileNavigationDropdown links={Object.values(links)} />
      </div>
    </>
  );
};

export default ProfileSettingsTabs;
