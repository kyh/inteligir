import { use } from "react";
import { redirect } from "next/navigation";

import loadAppData from "~/lib/server/loaders/load-app-data";
import AppRouteShell from "~/app/(app)/components/AppRouteShell";

function AppLayout({ children }: React.PropsWithChildren) {
  const data = use(loadAppData());

  if ("redirect" in data) {
    return redirect(data.destination);
  }

  return <AppRouteShell data={data}>{children}</AppRouteShell>;
}

export default AppLayout;
