"use client";

import Alert from "@inteligir/ui/alert";
import If from "@inteligir/ui/if";
import Trans from "@inteligir/ui/trans";
import useUser from "@/core/hooks/use-user";

import UpdatePasswordForm from "@/app/dashboard/[organization]/settings/profile/components/update-password-form";

function UpdatePasswordFormContainer() {
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
}

export default UpdatePasswordFormContainer;

function WarnCannotUpdatePasswordAlert() {
  return (
    <Alert type={"warn"}>
      <Trans i18nKey={"profile:cannotUpdatePassword"} />
    </Alert>
  );
}
