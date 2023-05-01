import { use } from "react";
import { redirect } from "next/navigation";

import loadAuthPageData from "~/lib/server/loaders/load-auth-page-data";
import AuthPageShell from "~/app/auth/components/AuthPageShell";

function AuthLayout({ children }: React.PropsWithChildren) {
  const data = use(loadAuthPageData());

  if ("redirect" in data && data.destination) {
    return redirect(data.destination);
  }

  return <AuthPageShell language={data.language}>{children}</AuthPageShell>;
}

export default AuthLayout;
