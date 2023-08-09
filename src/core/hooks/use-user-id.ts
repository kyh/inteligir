import useUserSession from "./use-user-session";

const useUserId = () => {
  const session = useUserSession();

  return session?.auth?.user.id;
};

export default useUserId;
