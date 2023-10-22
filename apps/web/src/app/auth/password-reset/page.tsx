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
  return (
    <>
      <div>
        <Heading type={5}>
          <Trans i18nKey="auth:passwordResetLabel" />
        </Heading>
      </div>

      <div className="flex flex-col space-y-4">
        <PasswordResetContainer />

        <div className="flex justify-center text-xs">
          <p className="flex space-x-1">
            <span>
              <Trans i18nKey="auth:passwordRecoveredQuestion" />
            </span>

            <Link
              className="text-primary-800 dark:text-primary hover:underline"
              href={configuration.paths.signIn}
            >
              <Trans i18nKey="auth:signIn" />
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default withI18n(PasswordResetPage);
