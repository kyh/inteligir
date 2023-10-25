import Link from "next/link";
import Trans from "@inteligir/ui/trans";
import Heading from "@inteligir/ui/heading";
import { configuration } from "@/lib/configuration";
import SignInMethodsContainer from "@/app/auth/components/sign-in-methods-container";
import { withI18n } from "@/i18n/with-i18n";

const SIGN_UP_PATH = configuration.paths.signUp;

export const metadata = {
  title: "Sign In",
};

const SignInPage = () => {
  return (
    <>
      <div>
        <Heading type={5}>Sign in to your account</Heading>
      </div>
      <SignInMethodsContainer />
      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>Do not have an account yet?</span>

          <Link
            className="text-primary-800 dark:text-primary hover:underline"
            href={SIGN_UP_PATH}
          >
            Sign Up
          </Link>
        </p>
      </div>
    </>
  );
};

export default withI18n(SignInPage);
