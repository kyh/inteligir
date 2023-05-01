"use client";

import useUser from "~/core/hooks/use-user";
import If from "~/core/ui/If";
import Alert from "~/core/ui/Alert";
import Trans from "~/core/ui/Trans";

import UpdateEmailForm from "~/app/(app)/settings/profile/components/UpdateEmailForm";

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
      <Trans i18nKey="profile:cannotUpdateEmail" />
    </Alert>
  );
}
