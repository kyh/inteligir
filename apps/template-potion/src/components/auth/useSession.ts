import { useAuthValue } from '@/components/auth/auth-provider-client';

export function useSession() {
  return useAuthValue('session');
}
