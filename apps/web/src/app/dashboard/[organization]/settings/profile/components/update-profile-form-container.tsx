"use client";

import { useCallback, useContext } from "react";
import type { User } from "@supabase/gotrue-js";
import UserSessionContext from "@/features/auth/session-context";
import useUserSession from "@/features/user/use-user-session";
import type UserData from "@/features/users/user-data";
import UpdateProfileForm from "../components/UpdateProfileForm";
import UpdatePhoneNumberForm from "../components/UpdatePhoneNumberForm";
import SettingsTile from "../../components/SettingsTile";
import Trans from "ui/components/Trans";
import If from "ui/components/If";
import configuration from "@/configuration";

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
      <SettingsTile
        heading={<Trans i18nKey="profile:generalTab" />}
        subHeading={<Trans i18nKey="profile:generalTabSubheading" />}
      >
        <UpdateProfileForm
          onUpdateProfileData={onUpdateProfileData}
          session={session}
        />
      </SettingsTile>

      <If condition={configuration.auth.providers.phoneNumber}>
        <SettingsTile
          heading={<Trans i18nKey="profile:updatePhoneNumber" />}
          subHeading={<Trans i18nKey="profile:updatePhoneNumberSubheading" />}
        >
          <UpdatePhoneNumberForm
            onUpdate={(phone) => {
              onUpdateAuthData({ phone });
            }}
            session={session}
          />
        </SettingsTile>
      </If>
    </div>
  );
};

export default UpdateProfileFormContainer;
