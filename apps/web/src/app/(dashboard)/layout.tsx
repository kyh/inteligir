import { cookies } from "next/headers";
import { getCookie } from "cookies-next/server";

import { DocumentPlate, PublicPlate } from "@/components/editor/plate-provider";
import { Panels } from "@/components/layouts/panels";
import { Main } from "@/components/layouts/main";
import { RightPanelType } from "@/hooks/useResizablePanel";
import { getSession } from "@repo/api/auth/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  const PlateProvider = session ? DocumentPlate : PublicPlate;

  const navCookie = await getCookie("nav", { cookies });
  const rightPanelTypeCookie = await getCookie("right-panel-type", { cookies });

  const initialLayout = navCookie ? JSON.parse(navCookie) : { leftSize: 300, rightSize: 240 };

  const initialRightPanelType = rightPanelTypeCookie
    ? JSON.parse(rightPanelTypeCookie)
    : RightPanelType.comment;

  return (
    <div className="flex h-full min-h-dvh dark:bg-[#1F1F1F]">
      <PlateProvider>
        <Panels initialLayout={initialLayout} initialRightPanelType={initialRightPanelType}>
          <Main>{children}</Main>
        </Panels>
      </PlateProvider>
    </div>
  );
}
