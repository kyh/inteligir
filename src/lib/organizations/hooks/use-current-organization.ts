import { useContext } from "react";
import OrganizationContext from "~/lib/contexts/organization";

const useCurrentOrganization = () => {
  const { organization } = useContext(OrganizationContext);

  return organization;
};

export default useCurrentOrganization;
