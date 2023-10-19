import Link from "next/link";
import Trans from "ui/components/Trans";
import Heading from "ui/components/Heading";
import { withI18n } from "@/i18n/with-i18n";
import configuration from "@/configuration";
import SignInMethodsContainer from "@/app/auth/components/SignInMethodsContainer";

const SIGN_UP_PATH = configuration.paths.signUp;

export const metadata = {
  title: "Sign In",
};

const SignInPage = () => {
  return (
    <>
      <div>
        <Heading type={5}>
          <Trans i18nKey="auth:signInHeading" />
        </Heading>
      </div>

      <SignInMethodsContainer />

      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>
            <Trans i18nKey="auth:doNotHaveAccountYet" />
          </span>

          <Link
            className="text-primary-800 dark:text-primary hover:underline"
            href={SIGN_UP_PATH}
          >
            <Trans i18nKey="auth:signUp" />
          </Link>
        </p>
      </div>
    </>
  );
};

export default withI18n(SignInPage);
