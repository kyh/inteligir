"use client";

import useCurrentUserRole from "~/lib/organizations/hooks/use-current-user-role";
import type MembershipRole from "~/lib/organizations/types/membership-role";

const IfHasPermissions = ({
  children,
  condition,
  fallback = null,
}: React.PropsWithChildren<{
  condition: (role: MembershipRole) => boolean;
  fallback?: React.ReactNode | null;
}>) => {
  const currentUserRole = useCurrentUserRole();

  if (currentUserRole === undefined || !condition(currentUserRole)) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
};

export default IfHasPermissions;
