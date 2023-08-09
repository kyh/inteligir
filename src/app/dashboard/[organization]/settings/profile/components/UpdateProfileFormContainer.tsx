"use client";

import { useCallback, useContext } from "react";
import type { User } from "@supabase/gotrue-js";
import { siteConfig } from "~/config/site";
import useUserSession from "~/core/hooks/use-user-session";
import UserSessionContext from "~/core/session/contexts/user-session";
import UserData from "~/core/session/types/user-data";
import { If } from "~/components/If";
import UpdateProfileForm from "~/app/dashboard/[organization]/settings/profile/components/UpdateProfileForm";
import SettingsTile from "../../components/SettingsTile";
import UpdatePhoneNumberForm from "../components/UpdatePhoneNumberForm";

const UpdateProfileFormContainer = () => {
  const { userSession, setUserSession } = useContext(UserSessionContext);
  const session = useUserSession();

  const onUpdateProfileData = useCallback(
    (data: Partial<UserData>) => {
      const userRecordData = userSession?.data;

      if (userRecordData) {
        setUserSession({
          ...userSession,
          data: {
            ...userRecordData,
            ...data,
          },
        });
      }
    },
    [setUserSession, userSession],
  );

  const onUpdateAuthData = useCallback(
    (data: Partial<User>) => {
      const user = userSession?.auth;

      if (user) {
        setUserSession({
          ...userSession,
          auth: {
            ...user,
            ...data,
          },
        });
      }
    },
    [setUserSession, userSession],
  );

  if (!session) {
    return null;
  }

  return (
    <div className="flex flex-col space-y-8">
      <SettingsTile heading="General Settings">
        <UpdateProfileForm
          session={session}
          onUpdateProfileData={onUpdateProfileData}
        />
      </SettingsTile>
      <If condition={siteConfig.auth.providers.phoneNumber}>
        <SettingsTile heading="Update Phone Number">
          <UpdatePhoneNumberForm
            session={session}
            onUpdate={(phone) => {
              onUpdateAuthData({ phone });
            }}
          />
        </SettingsTile>
      </If>
    </div>
  );
};

export default UpdateProfileFormContainer;
