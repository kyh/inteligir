import Link from "next/link";
import Trans from "~/core/ui/Trans";

import Heading from "~/core/ui/Heading";
import configuration from "~/configuration";
import SignInMethodsContainer from "~/app/auth/components/SignInMethodsContainer";

const SIGN_UP_PATH = configuration.paths.signUp;

export const metadata = {
  title: "Sign In",
};

function SignInPage() {
  return <>
    <div>
      <Heading type={6}>
        <span className="font-medium">
          Sign in to your account
        </span>
      </Heading>
    </div>

    <SignInMethodsContainer />

    <div className="flex justify-center text-xs">
      <p className="flex space-x-1">
        <span>
          Do not have an account yet?
        </span>

        <Link
          className="text-primary-800 hover:underline dark:text-primary-500"
          href={SIGN_UP_PATH}
        >
          Sign Up
        </Link>
      </p>
    </div>
  </>;
}

export default SignInPage;
