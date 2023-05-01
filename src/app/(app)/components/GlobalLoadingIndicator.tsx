"use client";

import TopLoadingBarIndicator from "~/components/TopLoadingBarIndicator";
import PageLoadingIndicator from "~/core/ui/PageLoadingIndicator";

function GlobalLoadingIndicator() {
  return (
    <>
      <TopLoadingBarIndicator />

      <div className="flex flex-1 flex-col items-center justify-center py-48">
        <PageLoadingIndicator displayLogo={false} fullPage={false} />
      </div>
    </>
  );
}

export default GlobalLoadingIndicator;
