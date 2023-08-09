import useUserSession from "~/core/hooks/use-user-session";

const useCurrentUserRole = () => {
  const user = useUserSession();

  return user?.role;
};

export default useCurrentUserRole;
