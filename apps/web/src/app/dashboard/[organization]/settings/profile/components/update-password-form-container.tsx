"use client";

import useUser from "@/features/users/use-user";
import Alert from "ui/components/Alert";
import If from "ui/components/If";
import Trans from "ui/components/Trans";
import UpdatePasswordForm from "@/app/dashboard/[organization]/settings/profile/components/UpdatePasswordForm";

const UpdatePasswordFormContainer = () => {
  const { data: user } = useUser();

  if (!user) {
    return null;
  }

  const canUpdatePassword = user.identities?.some(
    (item) => item.provider === `email`,
  );

  return (
    <If
      condition={canUpdatePassword}
      fallback={<WarnCannotUpdatePasswordAlert />}
    >
      <UpdatePasswordForm user={user} />
    </If>
  );
};

export default UpdatePasswordFormContainer;

const WarnCannotUpdatePasswordAlert = () => {
  return (
    <Alert type="warn">
      <Trans i18nKey="profile:cannotUpdatePassword" />
    </Alert>
  );
};
