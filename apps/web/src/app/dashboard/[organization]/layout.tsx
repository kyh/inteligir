import loadAppData from "@/features/global/load-app-data";
import AppRouteShell from "@/app/dashboard/[organization]/components/app-route-shell";

const AppLayout = async ({
  children,
  params,
}: React.PropsWithChildren<{
  params: {
    organization: string;
  };
}>) => {
  const data = await loadAppData(params.organization);

  return <AppRouteShell data={data}>{children}</AppRouteShell>;
};

export default AppLayout;
