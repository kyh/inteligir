import useMutation from "swr/mutation";
import type { UserAttributes } from "@supabase/gotrue-js";

import useSupabase from "~/core/hooks/use-supabase";

/**
 * @name useUpdateUserMutation
 */
function useUpdateUserMutation() {
  const client = useSupabase();
  const key = ["auth", "update-user"];

  return useMutation(key, (_, { arg: attributes }: { arg: UserAttributes }) => {
    return client.auth.updateUser(attributes).then((response) => {
      if (response.error) {
        throw response.error;
      }

      return response.data;
    });
  });
}

export default useUpdateUserMutation;
