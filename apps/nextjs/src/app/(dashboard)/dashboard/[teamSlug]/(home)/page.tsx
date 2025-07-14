import { PageHeader } from "@/components/header";
import { HydrateClient } from "@/trpc/server";

type PageProps = {
  params: Promise<{
    teamSlug: string;
  }>;
};

const Page = async (props: PageProps) => {
  return (
    <HydrateClient>
      <main className="flex h-dvh flex-1 flex-col px-5 pb-5">
        <PageHeader>Welcome back</PageHeader>
      </main>
    </HydrateClient>
  );
};

export default Page;
