import { useCallback } from 'react';

import { useAuthUser } from '@/components/auth/useAuthUser';
import { pushModal } from '@/components/modals';
import { useIsIframe } from '@/lib/navigation/useQueryState';

export const useAuthGuard = () => {
  const user = useAuthUser();

  const isIframe = useIsIframe();

  return useCallback(
    (callback?: () => Promise<void> | void) => {
      if (!user?.id) {
        if (isIframe) {
          window.open('https://potion.platejs.org/login', '_blank');

          return true;
        } else {
          pushModal('Login');
        }

        return true;
      }

      return callback ? void callback() : false;
    },
    [isIframe, user?.id]
  );
};
