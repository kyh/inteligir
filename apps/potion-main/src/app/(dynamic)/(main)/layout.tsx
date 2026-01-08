import { getCookie } from 'cookies-next/server';
import { cookies } from 'next/headers';
import { Main } from '@/app/(dynamic)/(main)/main';
import { isAuth } from '@/components/auth/rsc/auth';
import { DocumentPlate, PublicPlate } from '@/components/editor/plate-provider';
import { Panels } from '@/components/layouts/panels';
import { RightPanelType } from '@/hooks/useResizablePanel';

export default async function MainLayout(props: LayoutProps<'/'>) {
  const { children } = props;
  const session = await isAuth();

  const PlateProvider = session ? DocumentPlate : PublicPlate;

  const navCookie = await getCookie('nav', { cookies });
  const rightPanelTypeCookie = await getCookie('right-panel-type', {
    cookies,
  });

  const initialLayout = navCookie
    ? JSON.parse(navCookie)
    : { leftSize: 300, rightSize: 240 };

  const initialRightPanelType = rightPanelTypeCookie
    ? JSON.parse(rightPanelTypeCookie)
    : RightPanelType.comment;

  return (
    <div className="flex h-full min-h-dvh dark:bg-[#1F1F1F]">
      <PlateProvider>
        <Panels
          initialLayout={initialLayout}
          initialRightPanelType={initialRightPanelType}
        >
          <Main>{children}</Main>
        </Panels>
      </PlateProvider>
    </div>
  );
}
