import Link from "next/link";
import Heading from "@inteligir/ui/heading";
import Trans from "@inteligir/ui/trans";
import configuration from "@/configuration";
import PasswordResetContainer from "@/app/auth/components/password-reset-container";
import { withI18n } from "@/i18n/with-i18n";

export const metadata = {
  title: "Password Reset",
};

const PasswordResetPage = () => {
  return (<>
    <div>
      <Heading type={5}>
        Reset Password
      </Heading>
    </div>
    <div className="flex flex-col space-y-4">
      <PasswordResetContainer />

      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>
            Password recovered?
          </span>

          <Link
            className="text-primary-800 dark:text-primary hover:underline"
            href={configuration.paths.signIn}
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  </>);
};

export default withI18n(PasswordResetPage);
