import Link from "next/link";
import { Text } from "~/components/Text";
import PasswordResetContainer from "~/app/auth/components/PasswordResetContainer";

export const metadata = {
  title: "Password Reset",
};

const PasswordResetPage = () => {
  return (
    <>
      <div>
        <Text>
          <span className="font-medium">Reset Password</span>
        </Text>
      </div>

      <div className="flex flex-col space-y-4">
        <PasswordResetContainer />

        <div className="flex justify-center text-xs">
          <p className="flex space-x-1">
            <span>Password recovered?</span>

            <Link
              className="text-emerald-800 hover:underline dark:text-emerald-500"
              href="/auth/sign-in"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default PasswordResetPage;
