"use client";

import { useState } from "react";

export const Steps = () => {
  const [currentTab, setCurrentTab] = useState(1);

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto h-[0.080rem] max-w-3xl bg-gradient-to-r from-brand-950 via-brand-300 to-brand-950" />
      <div className="container max-w-6xl py-12 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="bg-gradient-to-r from-brand-50 via-brand-300 to-brand-600 bg-clip-text pb-2 font-display text-4xl font-normal tracking-tight text-transparent sm:text-5xl">
            AI powered <span className="lg:block">data workspace</span>
          </p>
          <p className="mx-auto mt-4 max-w-sm text-brand-300">
            We'll handle the data reporting so you can focus on driving results
          </p>
        </div>

        <div className="relative mt-12 rounded-3xl bg-gradient-to-t from-white/20 p-2 ring-1 ring-white/10">
          <div className="relative flex w-full select-none flex-col justify-center gap-2 rounded-2xl bg-brand-800/80 shadow-massive sm:inline-grid sm:grid-cols-3 md:gap-6 md:rounded-b-none md:rounded-t-3xl lg:flex-none lg:items-center">
            <button
              type="button"
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => setCurrentTab(1)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-brand-300"
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
                <p className="text-base font-medium text-brand-50">
                  Connect your Data
                </p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Inteligir connects to the database and tools your team is
                already using. Combine multiple sources to discover unique
                insights.
              </p>
            </button>
            <button
              type="button"
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => setCurrentTab(2)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-brand-300"
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
                <p className="text-lg font-medium text-brand-50">
                  Ask your top questions
                </p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <button
              type="button"
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => setCurrentTab(3)}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-brand-300"
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
                <p className="text-lg font-medium text-brand-50">
                  Generate custom reports
                </p>
              </div>
              <p className="mt-2 text-sm text-brand-300">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <div className="absolute left-0 z-10 hidden h-full w-1/2 duration-300 ease-out md:block">
              <div className="ml-8 h-full w-12 border-b-[3px] border-brand-500" />
            </div>
          </div>
          <div className="content relative hidden w-full items-center justify-center overflow-hidden border-t border-brand-700 shadow-sm md:block md:rounded-b-3xl">
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
                ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
