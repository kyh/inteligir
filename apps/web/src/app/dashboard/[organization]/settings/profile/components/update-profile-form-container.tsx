"use client";

import { useCallback, useContext } from "react";

import UserSessionContext from "@/core/session/contexts/user-session";
import useUserSession from "@/core/hooks/use-user-session";
import UserData from "@/core/session/types/user-data";
import UpdateProfileForm from "./update-profile-form";
import Trans from "@inteligir/ui/trans";

import UpdatePhoneNumberForm from "./update-phone-number-form";
import SettingsTile from "../../components/settings-tile";
import If from "@inteligir/ui/if";
import configuration from "@/configuration";

import { refreshSessionAction } from "../actions";

function UpdateProfileFormContainer() {
  const { userSession, setUserSession } = useContext(UserSessionContext);
  const session = useUserSession();

  const onUpdateProfileData = useCallback(
    async (data: Partial<UserData>) => {
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

      await refreshSessionAction();
    },
    [setUserSession, userSession],
  );

  if (!session) {
    return null;
  }

  return (
    <div className={"flex flex-col space-y-8"}>
      <SettingsTile
        heading={<Trans i18nKey={"profile:generalTab"} />}
        subHeading={<Trans i18nKey={"profile:generalTabSubheading"} />}
      >
        <UpdateProfileForm
          session={session}
          onUpdateProfileData={onUpdateProfileData}
        />
      </SettingsTile>

      <If condition={configuration.auth.providers.phoneNumber}>
        <SettingsTile
          heading={<Trans i18nKey={"profile:updatePhoneNumber"} />}
          subHeading={<Trans i18nKey={"profile:updatePhoneNumberSubheading"} />}
        >
          <UpdatePhoneNumberForm
            session={session}
            onUpdate={async () => {
              await refreshSessionAction();
            }}
          />
        </SettingsTile>
      </If>
    </div>
  );
}

export default UpdateProfileFormContainer;
