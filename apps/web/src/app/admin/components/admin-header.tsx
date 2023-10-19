import { ArrowLeft } from "@inteligir/icons";
import { Button, Heading } from "@inteligir/ui";
import Link from "next/link";
import AppContainer from "@/app/dashboard/[organization]/components/app-container";

const AdminHeader = ({ children }: React.PropsWithChildren) => {
  return (
    <div className="dark:border-dark-700 flex items-center justify-between border-b border-gray-50">
      <AppContainer>
        <div className="flex w-full items-center justify-between">
          <div>
            <Heading level="h3">{children}</Heading>
          </div>
          <Button asChild variant="transparent">
            <Link className="flex items-center space-x-2.5" href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </Link>
          </Button>
        </div>
      </AppContainer>
    </div>
  );
};

export default AdminHeader;
