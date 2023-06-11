import Link from "next/link";
import configuration from "~/configuration";
import { Text } from "~/components/Text";
import SignInMethodsContainer from "~/app/auth/components/SignInMethodsContainer";

const SIGN_UP_PATH = configuration.paths.signUp;

export const metadata = {
  title: "Sign In",
};

function SignInPage() {
  return (
    <>
      <div>
        <Text>
          <span className="font-medium">Sign in to your account</span>
        </Text>
      </div>
      <SignInMethodsContainer />
      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>Do not have an account yet?</span>

          <Link
            className="text-emerald-800 hover:underline dark:text-emerald-500"
            href={SIGN_UP_PATH}
          >
            Sign Up
          </Link>
        </p>
      </div>
    </>
  );
}

export default SignInPage;
