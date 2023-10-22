'use client';

import TopLoadingBarIndicator from '~/components/TopLoadingBarIndicator';
import PageLoadingIndicator from '~/core/ui/PageLoadingIndicator';
import Trans from '~/core/ui/Trans';

function GlobalLoadingIndicator({
  children,
  displayLogo = false,
  fullPage = false,
}: React.PropsWithChildren<{
  displayLogo?: boolean;
  fullPage?: boolean;
}>) {
  const Text = children ?? <Trans i18nKey={'common:loading'} />;

  return (
    <>
      <TopLoadingBarIndicator />

      <div className={'flex flex-1 flex-col items-center justify-center py-48'}>
        <PageLoadingIndicator displayLogo={displayLogo} fullPage={fullPage}>
          {Text}
        </PageLoadingIndicator>
      </div>
    </>
  );
}

export default GlobalLoadingIndicator;
