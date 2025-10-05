import { useAuthValue } from '@/components/auth/auth-provider-client';

export const useAuthUser = () => {
  return useAuthValue('user');
};
