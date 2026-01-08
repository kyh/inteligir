import { useMutation } from '@tanstack/react-query';

import { encodeURL } from '@/lib/url/encodeURL';
import { signOut } from '@/server/auth/auth-client';

export const useLogoutMutation = () =>
  useMutation({
    mutationFn: async () => {
      await signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = `/?callbackUrl=${encodeURL(window.location.pathname, window.location.search)}`;
          },
        },
      });
    },
    onError: (error) => {
      console.error('Logout error:', error);
    },
  });
