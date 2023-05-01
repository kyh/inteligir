import Link from "next/link";

import configuration from "~/configuration";
import Heading from "~/core/ui/Heading";
import Trans from "~/core/ui/Trans";

import PasswordResetContainer from "~/app/auth/components/PasswordResetContainer";

export const metadata = {
  title: "Password Reset",
};

function PasswordResetPage() {
  return (
    <>
      <div>
        <Heading type={6}>
          <span className="font-medium">
            <Trans i18nKey="auth:passwordResetLabel" />
          </span>
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
              className="text-primary-800 hover:underline dark:text-primary-500"
              href={configuration.paths.signIn}
            >
              <Trans i18nKey="auth:signIn" />
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}

export default PasswordResetPage;
