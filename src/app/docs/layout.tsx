import { FooterNavigation } from "~/app/docs/components/FooterNavigation";
import { Prose } from "~/app/docs/components/Prose";
import { SideNavigation } from "~/app/docs/components/SideNavigation";
import { TopNavigation } from "~/app/docs/components/TopNavigation";

type DocsLayoutProps = {
  children: React.ReactNode;
};

const DocsLayout = ({ children }: DocsLayoutProps) => {
  return (
    <div className="lg:ml-72">
      <header className="fixed inset-y-0 left-0 z-40 contents w-72 overflow-y-auto border-r border-border px-6 pb-8 pt-4 lg:block">
        <TopNavigation userSession={undefined} />
        <SideNavigation />
      </header>
      <div className="relative min-h-screen px-4 pt-16 sm:px-6 lg:px-8">
        <main className="py-16">
          <Prose as="article">{children}</Prose>
        </main>
        <FooterNavigation />
      </div>
    </div>
  );
};

export default DocsLayout;
