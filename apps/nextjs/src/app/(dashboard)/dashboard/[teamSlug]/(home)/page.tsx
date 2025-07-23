import { PageHeader } from "@/components/header";
import { HydrateClient } from "@/trpc/server";
import { AIChatForm } from "./_components/ai-chat-form";

type PageProps = {
  params: Promise<{
    teamSlug: string;
  }>;
};

const Page = async (props: PageProps) => {
  const params = await props.params;
  const teamSlug = params.teamSlug;

  return (
    <HydrateClient>
      <main className="flex h-dvh flex-1 flex-col px-5 pb-5">
        <PageHeader>Welcome back</PageHeader>
        <AIChatForm teamSlug={teamSlug} />
      </main>
    </HydrateClient>
  );
};

export default Page;
