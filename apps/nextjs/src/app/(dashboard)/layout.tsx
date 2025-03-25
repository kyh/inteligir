import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { Sidebar } from "./_components/sidebar";

export const dynamic = "force-dynamic";

type LayoutProps = {
  children: React.ReactNode;
};

const Layout = (props: LayoutProps) => {
  prefetch(trpc.auth.workspace.queryOptions());

  return (
    <HydrateClient>
      <div className="flex min-h-dvh">
        <Sidebar />
        {props.children}
      </div>
    </HydrateClient>
  );
};

export default Layout;
