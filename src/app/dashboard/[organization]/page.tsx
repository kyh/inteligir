import loadDynamic from 'next/dynamic';
import { Squares2X2Icon } from '@heroicons/react/24/outline';

import AppHeader from './components/AppHeader';
import AppContainer from './components/AppContainer';
import { withI18n } from '~/i18n/with-i18n';
import Spinner from '~/core/ui/Spinner';
import Trans from '~/core/ui/Trans';

const DashboardDemo = loadDynamic(() => import('./components/DashboardDemo'), {
  ssr: false,
  loading: () => (
    <div
      className={
        'flex flex-1 items-center min-h-full justify-center flex-col' +
        ' space-y-4'
      }
    >
      <Spinner className={'text-primary'} />

      <div>Loading dashboard...</div>
    </div>
  ),
});

export const metadata = {
  title: 'Dashboard',
};

function DashboardPage() {
  return (
    <>
      <AppHeader Icon={<Squares2X2Icon className={'h-6 dark:text-primary'} />}>
        <Trans i18nKey={'common:dashboardTabLabel'} />
      </AppHeader>

      <AppContainer>
        <DashboardDemo />
      </AppContainer>
    </>
  );
}

export default withI18n(DashboardPage);
