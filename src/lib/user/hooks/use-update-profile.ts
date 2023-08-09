import useMutation from "swr/mutation";
import useSupabase from "~/core/hooks/use-supabase";
import type UserData from "~/core/session/types/user-data";
import { updateUserData } from "~/lib/user/mutations";

type Payload = WithId<Partial<UserData>>;

const useUpdateProfile = () => {
  const client = useSupabase();
  const key = "useUpdateProfile";

  return useMutation(key, async (_, { arg: data }: { arg: Payload }) => {
    return updateUserData(client, data);
  });
};

export default useUpdateProfile;
