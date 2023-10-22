import { loadAuthPageData } from "@/features/global/load-auth-page-data";
import AuthPageShell from "./components/auth-page-shell";

const AuthLayout = async ({ children }: React.PropsWithChildren) => {
  await loadAuthPageData();

  return <AuthPageShell>{children}</AuthPageShell>;
};

export default AuthLayout;
