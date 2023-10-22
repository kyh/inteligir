import Logo from '~/core/ui/Logo';

async function OnboardingLayout({ children }: React.PropsWithChildren) {
  return (
    <div className={'flex flex-1 flex-col dark:bg-background'}>
      <div className={'flex divide-x divide-gray-100 dark:divide-dark-700'}>
        <div
          className={
            'flex h-screen w-full flex-1 flex-col items-center' +
            ' justify-center lg:w-6/12 mx-auto xl:max-w-3xl'
          }
        >
          <div className={'absolute top-12 xl:top-24'}>
            <Logo href={'/onboarding'} />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

export default OnboardingLayout;
