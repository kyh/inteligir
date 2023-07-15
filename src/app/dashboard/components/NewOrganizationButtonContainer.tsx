"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import CsrfTokenContext from "~/lib/contexts/csrf";
import { Button } from "~/components/Button";
import CreateOrganizationModal from "~/app/dashboard/[organization]/components/organizations/CreateOrganizationModal";

const NewOrganizationButtonContainer = ({
  csrfToken,
}: React.PropsWithChildren<{
  csrfToken: string;
}>) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <CsrfTokenContext.Provider value={csrfToken}>
      <Button onClick={() => setIsOpen(true)}>
        <span className="flex items-center space-x-4">
          <PlusIcon className="h-6 w-6" />

          <span className="text-base font-medium">
            Create a new organization
          </span>
        </span>
      </Button>
      <CreateOrganizationModal isOpen={isOpen} setIsOpen={setIsOpen} />
    </CsrfTokenContext.Provider>
  );
};

export default NewOrganizationButtonContainer;
