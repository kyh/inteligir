import { useAuthStore } from '@/components/auth/auth-provider-client';

export function useSession() {
  const session = useAuthStore().useSessionValue();

  if (!session) return null;

  return session;
}

export const useIsAuth = () => !!useSession();
