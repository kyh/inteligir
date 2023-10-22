import useMutation from "swr/mutation";
import type { UserAttributes } from "@supabase/gotrue-js";
import { useSupabase } from "@/lib/supabase/use-supabase";

type Params = { arg: UserAttributes & { redirectTo: string } };

export const useUpdateUserMutation = () => {
  const client = useSupabase();
  const key = ["auth", "update-user"];

  return useMutation(key, (_, { arg: attributes }: Params) => {
    const { redirectTo, ...params } = attributes;

    return client.auth
      .updateUser(params, {
        emailRedirectTo: redirectTo,
      })
      .then((response) => {
        if (response.error) {
          throw response.error;
        }

        return response.data;
      });
  });
};
