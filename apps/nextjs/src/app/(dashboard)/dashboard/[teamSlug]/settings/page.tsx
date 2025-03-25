import { PageHeader } from "@/components/header";
import { TeamDeleteForm } from "./_components/team-delete-form";
import { TeamProfileForm } from "./_components/team-profile-form";

type PageProps = {
  params: Promise<{
    teamSlug: string;
  }>;
};

const Page = async (props: PageProps) => {
  const params = await props.params;
  const teamSlug = params.teamSlug;

  return (
    <main className="flex flex-1 flex-col px-5">
      <PageHeader>Team Settings</PageHeader>
      <section className="divide-border divide-y">
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-8 md:grid-cols-3">
          <div>
            <h2 className="text-primary text-base leading-7 font-light">
              Team Information
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Update your team's information
            </p>
          </div>
          <div className="md:col-span-2">
            <TeamProfileForm teamSlug={teamSlug} />
          </div>
        </div>
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-8 md:grid-cols-3">
          <div>
            <h2 className="text-primary text-base leading-7 font-light">
              Danger Zone
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              This section contains actions that are irreversible
            </p>
          </div>
          <div className="md:col-span-2">
            <TeamDeleteForm teamSlug={teamSlug} />
          </div>
        </div>
      </section>
    </main>
  );
};

export default Page;
