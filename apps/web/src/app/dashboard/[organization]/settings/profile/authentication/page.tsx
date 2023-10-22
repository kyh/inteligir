import MultiFactorAuthenticationSettings from "./components/multi-factor-authentication-settings";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Authentication",
};

function AuthenticationPage() {
  return <MultiFactorAuthenticationSettings />;
}

export default withI18n(AuthenticationPage);
