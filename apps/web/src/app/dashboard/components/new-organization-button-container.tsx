"use client";

import { PlusMini } from "@inteligir/icons";
import CardButton from "@inteligir/ui/card-button";
import { CsrfTokenContext } from "@/lib/csrf/csrf-provider";
import CreateOrganizationModal from "@/app/dashboard/[organization]/components/organizations/create-organization-modal";

const NewOrganizationButtonContainer = ({
  csrfToken,
}: React.PropsWithChildren<{
  csrfToken: string;
}>) => {
  return (
    <CsrfTokenContext.Provider value={csrfToken}>
      <CreateOrganizationModal
        Trigger={
          <CardButton>
            <span className="flex items-center space-x-4">
              <PlusMini className="h-6 w-6" />

              <span className="text-base font-medium">
                Create a new organization
              </span>
            </span>
          </CardButton>
        }
      />
    </CsrfTokenContext.Provider>
  );
};

export default NewOrganizationButtonContainer;
