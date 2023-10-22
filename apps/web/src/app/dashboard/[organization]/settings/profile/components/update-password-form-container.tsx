"use client";

import Alert from "@inteligir/ui/alert";
import If from "@inteligir/ui/if";
import Trans from "@inteligir/ui/trans";
import UpdatePasswordForm from "@/app/dashboard/[organization]/settings/profile/components/update-password-form";
import useUser from "@/core/hooks/use-user";

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

const WarnCannotUpdatePasswordAlert = () => (
  <Alert type="warn">
    You cannot update your password because your account is not linked to any.
  </Alert>
);
