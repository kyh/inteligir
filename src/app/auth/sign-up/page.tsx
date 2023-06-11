import Link from "next/link";
import configuration from "~/configuration";
import { Text } from "~/components/Text";
import SignUpMethodsContainer from "~/app/auth/components/SignUpMethodsContainer";

const SIGN_IN_PATH = configuration.paths.signIn;

export const metadata = {
  title: "Sign up",
};

function SignUpPage() {
  return (
    <>
      <div>
        <Text className="font-medium">Create an account</Text>
      </div>

      <SignUpMethodsContainer />

      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>Already have an account?</span>

          <Link
            className="text-emerald-800 hover:underline dark:text-emerald-500"
            href={SIGN_IN_PATH}
          >
            Sign In
          </Link>
        </p>
      </div>
    </>
  );
}

export default SignUpPage;
