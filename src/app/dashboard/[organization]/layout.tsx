import { use } from "react";
import loadAppData from "~/lib/server/loaders/load-app-data";
import AppRouteShell from "~/app/dashboard/components/AppRouteShell";

export const dynamic = "force-dynamic";

function AppLayout({
  children,
  params,
}: React.PropsWithChildren<{
  params: {
    organization: string;
  };
}>) {
  const data = use(loadAppData(params.organization));

  return <AppRouteShell data={data}>{children}</AppRouteShell>;
}

export default AppLayout;
