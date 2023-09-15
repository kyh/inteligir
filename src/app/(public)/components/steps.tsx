"use client";

import { useState } from "react";

export const Steps = () => {
  const [currentTab, setCurrentTab] = useState(1);

  return (
    <section className="relative overflow-hidden">
      <div className="h-[0.080rem] bg-gradient-to-r from-brand-950 max-w-3xl mx-auto via-brand-300 to-brand-950" />
      <div className="px-8 py-12 mx-auto max-w-6xl lg:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <p className="bg-gradient-to-r from-brand-50 via-brand-300 to-brand-600 bg-clip-text text-transparent text-4xl font-normal font-display tracking-tight pb-2 sm:text-5xl">
            Empowering <span className="lg:block">learning experiences</span>
          </p>
          <p className="text-brand-300 mt-4 max-w-sm mx-auto">
            Discover the features that make our platform your ultimate learning
            companion
          </p>
        </div>

        <div className="ring-1 p-2 rounded-3xl bg-gradient-to-t from-white/20 ring-white/10 relative mt-12">
          <div className="relative flex flex-col justify-center w-full gap-2 md:gap-6 shadow-massive bg-brand-800/80 select-none sm:inline-grid rounded-2xl md:rounded-t-3xl md:rounded-b-none lg:flex-none lg:items-center sm:grid-cols-3">
            <button
              type="button"
              className="relative flex flex-col w-full text-left p-4 md:p-8 z-20"
              onClick={() => setCurrentTab(1)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 icon icon-tabler text-brand-300 icon-tabler-3d-cube-sphere w-5"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M6 17.6l-2 -1.1v-2.5" opacity="0.5" />
                  <path d="M4 10v-2.5l2 -1.1" />
                  <path d="M10 4.1l2 -1.1l2 1.1" opacity="0.5" />
                  <path d="M18 6.4l2 1.1v2.5" />
                  <path d="M20 14v2.5l-2 1.12" opacity="0.5" />
                  <path d="M14 19.9l-2 1.1l-2 -1.1" />
                  <path d="M12 12l2 -1.1" />
                  <path d="M18 8.6l2 -1.1" />
                  <path d="M12 12l0 2.5" />
                  <path d="M12 18.5l0 2.5" />
                  <path d="M12 12l-2 -1.12" />
                  <path d="M6 8.6l-2 -1.1" />
                </svg>
                <p className="text-base font-medium text-brand-50">Encrypted</p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Use blockchain technology to create decentralized autonomous
                organizations and manage.
              </p>
            </button>
            <button
              type="button"
              className="relative flex flex-col w-full text-left p-4 md:p-8 z-20"
              onClick={() => setCurrentTab(2)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 icon icon-tabler text-brand-300 icon-tabler-adjustments-alt"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M4 8h4v4h-4z" />
                  <path d="M6 4l0 4" />
                  <path d="M6 12l0 8" opacity="0.5" />
                  <path d="M10 14h4v4h-4z" />
                  <path d="M12 4l0 10" opacity="0.5" />
                  <path d="M12 18l0 2" />
                  <path d="M16 5h4v4h-4z" />
                  <path d="M18 4l0 1" />
                  <path d="M18 9l0 11" opacity="0.5" />
                </svg>
                <p className="text-lg font-medium text-brand-50">Privacy</p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <button
              type="button"
              className="relative flex flex-col w-full text-left p-4 md:p-8 z-20"
              onClick={() => setCurrentTab(3)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 icon icon-tabler text-brand-300 icon-tabler-file-unknown"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path
                    opacity="0.5"
                    d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"
                  />
                  <path d="M12 17v.01" />
                  <path d="M12 14a1.5 1.5 0 1 0 -1.14 -2.474" />
                </svg>
                <p className="text-lg font-medium text-brand-50">Storage</p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <div className="absolute left-0 z-10 hidden w-1/2 h-full duration-300 ease-out md:block">
              <div className="w-12 ml-8 h-full border-b-[3px] border-brand-500" />
            </div>
          </div>
          <div className="relative items-center justify-center hidden w-full border-t border-brand-700 shadow-sm overflow-hidden content md:rounded-b-3xl md:block">
            {[1, 2, 3].map(
              (i) =>
                currentTab === i && (
                  <div className="relative" key={i}>
                    <div className="w-full overflow-hidden">
                      <img
                        alt=""
                        src={`/screenshots/chart${i}.svg`}
                        className="w-full invert"
                      />
                    </div>
                  </div>
                )
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
