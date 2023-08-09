"use client";

import useUser from "~/core/hooks/use-user";
import { Alert } from "~/components/Alert";
import { If } from "~/components/If";
import UpdatePasswordForm from "~/app/dashboard/[organization]/settings/profile/components/UpdatePasswordForm";

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
      You cannot update your password because your account is not linked to any.
    </Alert>
  );
};
