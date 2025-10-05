import type { InferResponseType } from 'hono';

import { useMutation } from '@tanstack/react-query';

import { routes } from '@/lib/navigation/routes';
import { encodeURL } from '@/lib/url/encodeURL';
import { honoApi } from '@/server/hono/hono-client';

const $post = honoApi.auth.logout.$post;

export const useLogoutMutation = () => {
  return useMutation<InferResponseType<typeof $post>>({
    mutationFn: async () => {
      const res = await $post();

      return await res.json();
    },
    onError: (error) => {
      console.error('Logout error:', error);
    },
    onSuccess: () => {
      window.location.href =
        routes.home() +
        `?callbackUrl=${encodeURL(window.location.pathname, window.location.search)}`;
    },
  });
};
