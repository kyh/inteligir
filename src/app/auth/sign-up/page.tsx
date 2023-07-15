import Link from "next/link";
import { Text } from "~/components/Text";
import SignUpMethodsContainer from "~/app/auth/components/SignUpMethodsContainer";

export const metadata = {
  title: "Sign up",
};

const SignUpPage = () => {
  return (
    <>
      <Text as="h1" className="font-medium">
        Create an account
      </Text>
      <SignUpMethodsContainer />
      <div className="flex justify-center text-xs">
        <p className="flex space-x-1">
          <span>Already have an account?</span>
          <Link
            className="text-emerald-800 hover:underline dark:text-emerald-500"
            href="/auth/sign-in"
          >
            Sign In
          </Link>
        </p>
      </div>
    </>
  );
};

export default SignUpPage;
