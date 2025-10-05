import type { LayoutProps } from '@/lib/navigation/next-types';

import { MainScreen } from '@/components/screens/main-screen';

export default function Layout({ children }: LayoutProps) {
  return (
    <MainScreen size="full" className="flex justify-center">
      {children}
    </MainScreen>
  );
}
