"use client";

import useUser from "~/core/hooks/use-user";
import Alert from "~/components/Alert";
import If from "~/components/If";
import UpdateEmailForm from "~/app/(dashboard)/settings/profile/components/UpdateEmailForm";

function UpdateEmailFormContainer() {
  const { data: user } = useUser();

  if (!user) {
    return null;
  }

  const canUpdateEmail = user.identities?.some(
    (item) => item.provider === `email`
  );

  return (
    <If condition={canUpdateEmail} fallback={<WarnCannotUpdateEmailAlert />}>
      <UpdateEmailForm user={user} />
    </If>
  );
}

export default UpdateEmailFormContainer;

function WarnCannotUpdateEmailAlert() {
  return (
    <Alert type="warn">
      You cannot update your email because your account is not linked to any.
    </Alert>
  );
}
