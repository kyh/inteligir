import { HydrateClient, prefetch, trpc } from "@/trpc/server";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    teamSlug: string;
  }>;
};

const Layout = async (props: LayoutProps) => {
  const params = await props.params;
  const teamSlug = params.teamSlug;

  prefetch(trpc.team.getTeam.queryOptions({ slug: teamSlug }));

  return <HydrateClient>{props.children}</HydrateClient>;
};

export default Layout;
