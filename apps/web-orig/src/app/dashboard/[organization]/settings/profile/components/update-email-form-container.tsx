"use client";

import useUser from "@/features/users/use-user";
import UpdateEmailForm from "@/app/dashboard/[organization]/settings/profile/components/update-email-form";

const UpdateEmailFormContainer = () => {
  const { data: user } = useUser();

  if (!user) {
    return null;
  }

  return <UpdateEmailForm user={user} />;
};

export default UpdateEmailFormContainer;
