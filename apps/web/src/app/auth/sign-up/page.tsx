import Link from "next/link";
import Trans from "@inteligir/ui/trans";
import Heading from "@inteligir/ui/heading";
import SignUpMethodsContainer from "@/app/auth/components/sign-up-methods-container";
import configuration from "@/configuration";
import { withI18n } from "@/i18n/with-i18n";

const SIGN_IN_PATH = configuration.paths.signIn;

export const metadata = {
  title: "Sign up",
};

const SignUpPage = () => {
  return (<>
    <div>
      <Heading type={5}>
        Create an account
      </Heading>
    </div>
    <SignUpMethodsContainer />
    <div className="flex justify-center text-xs">
      <p className="flex space-x-1">
        <span>
          Already have an account?
        </span>

        <Link
          className="text-primary-800 dark:text-primary hover:underline"
          href={SIGN_IN_PATH}
        >
          Sign In
        </Link>
      </p>
    </div>
  </>);
};

export default withI18n(SignUpPage);
