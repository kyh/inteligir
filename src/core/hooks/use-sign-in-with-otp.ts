import type {
  AuthError,
  SignInWithPasswordlessCredentials,
} from "@supabase/gotrue-js";
import { siteConfig } from "~/config/site";
import useMutation from "swr/mutation";
import useSupabase from "~/core/hooks/use-supabase";

const useSignInWithOtp = () => {
  const client = useSupabase();
  const key = ["auth", "sign-in-with-otp"];

  return useMutation(
    key,
    (_, { arg: credentials }: { arg: SignInWithPasswordlessCredentials }) => {
      return client.auth.signInWithOtp(credentials).then((result) => {
        if (result.error) {
          if (shouldIgnoreError(result.error)) {
            console.warn(
              `Ignoring error during development: ${result.error.message}`,
            );

            return {};
          }

          throw result.error.message;
        }

        return result.data;
      });
    },
  );
};

export default useSignInWithOtp;

const shouldIgnoreError = (error: AuthError) => {
  return !siteConfig.production && isSmsProviderNotSetupError(error);
};

const isSmsProviderNotSetupError = (error: AuthError) => {
  return (
    error.message === `Error sending sms: sms Provider  could not be found`
  );
};
