import UpdateProfileFormContainer from "@/app/dashboard/[organization]/settings/profile/components/update-profile-form-container";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Profile Settings",
};

const ProfileDetailsPage = () => {
  return <UpdateProfileFormContainer />;
};

export default withI18n(ProfileDetailsPage);
