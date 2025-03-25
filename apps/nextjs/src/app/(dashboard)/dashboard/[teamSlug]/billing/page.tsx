import { PageHeader } from "@/components/header";

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
      <PageHeader>Billing</PageHeader>
      <section className="divide-border divide-y">
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-8 md:grid-cols-3">
          <div>
            <h2 className="text-primary text-base leading-7 font-light">
              Your Plan
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Manage your subscription and billing details.
            </p>
          </div>
          <div className="md:col-span-2"></div>
        </div>
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-8 md:grid-cols-3">
          <div>
            <h2 className="text-primary text-base leading-7 font-light">
              Order History
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Download invoices and view your order history.
            </p>
          </div>
          <div className="space-y-3 md:col-span-2"></div>
        </div>
      </section>
    </main>
  );
};

export default Page;
