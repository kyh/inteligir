import { AuthProviderClient } from '@/components/auth/auth-provider-client';
import { getSession } from '@/server/auth/auth';

export async function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionData = await getSession();

  return (
    <AuthProviderClient session={sessionData}>{children}</AuthProviderClient>
  );
}
