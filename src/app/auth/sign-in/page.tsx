import Link from "next/link";
import { Text } from "~/components/Text";
import SignInMethodsContainer from "~/app/auth/components/SignInMethodsContainer";

export const metadata = {
  title: "Sign In",
};

const SignInPage = () => {
  return (
    <>
      <Text as="h1" className="font-medium">
        Sign in to your account
      </Text>
      <SignInMethodsContainer />
      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>Do not have an account yet?</span>
          <Link
            className="text-emerald-800 hover:underline dark:text-emerald-500"
            href="/auth/sign-up"
          >
            Sign Up
          </Link>
        </p>
      </div>
    </>
  );
};

export default SignInPage;
