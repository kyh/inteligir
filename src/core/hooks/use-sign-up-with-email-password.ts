import useSWRMutation from "swr/mutation";
import useSupabase from "./use-supabase";

type Credentials = {
  email: string;
  password: string;
};

const useSignUpWithEmailAndPassword = () => {
  const client = useSupabase();
  const key = ["auth", "sign-up-with-email-password"];

  return useSWRMutation(
    key,
    (_, { arg: credentials }: { arg: Credentials }) => {
      const emailRedirectTo = [window.location.origin, "/auth/callback"].join(
        "",
      );

      return client.auth
        .signUp({
          ...credentials,
          options: {
            emailRedirectTo,
          },
        })
        .then((response) => {
          if (response.error) {
            throw response.error.message;
          }

          return response.data;
        });
    },
  );
};

export default useSignUpWithEmailAndPassword;
