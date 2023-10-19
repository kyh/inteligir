import Link from "next/link";
import Trans from "ui/components/trans";
import Heading from "ui/components/heading";
import SignUpMethodsContainer from "@/app/auth/components/sign-up-methods-container";
import configuration from "@/configuration";
import { withI18n } from "@/i18n/with-i18n";

const SIGN_IN_PATH = configuration.paths.signIn;

export const metadata = {
  title: "Sign up",
};

const SignUpPage = () => {
  return (
    <>
      <div>
        <Heading type={5}>
          <Trans i18nKey="auth:signUpHeading" />
        </Heading>
      </div>

      <SignUpMethodsContainer />

      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>
            <Trans i18nKey="auth:alreadyHaveAnAccount" />
          </span>

          <Link
            className="text-primary-800 dark:text-primary hover:underline"
            href={SIGN_IN_PATH}
          >
            <Trans i18nKey="auth:signIn" />
          </Link>
        </p>
      </div>
    </>
  );
};

export default withI18n(SignUpPage);
