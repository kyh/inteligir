"use client";

import { useState } from "react";

export const Steps = () => {
  const [currentTab, setCurrentTab] = useState(1);

  return (
    <section className="relative overflow-hidden">
      <div className="from-ui-bg-base via-ui-fg-base to-ui-bg-base mx-auto h-px max-w-3xl bg-gradient-to-r" />
      <div className="container max-w-6xl py-12 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display bg-gradient-to-r from-slate-50 to-slate-600 bg-clip-text pb-2 text-4xl font-normal tracking-tight text-transparent sm:text-5xl">
            AI powered <span className="lg:block">data workspace</span>
          </h2>
          <p className="text-ui-fg-subtle mx-auto mt-4 max-w-sm">
            We'll handle the data reporting so you can focus on driving results
          </p>
        </div>

        <div className="relative mt-12 rounded-3xl bg-gradient-to-t from-white/20 p-2 ring-1 ring-white/10">
          <div className="bg-ui-bg-component relative flex w-full select-none flex-col justify-center gap-2 rounded-2xl shadow-xl sm:inline-grid sm:grid-cols-3 md:gap-6 md:rounded-b-none md:rounded-t-3xl lg:flex-none lg:items-center">
            <button
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => {
                setCurrentTab(1);
              }}
              type="button"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  className="text-ui-fg-subtle h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M0 0h24v24H0z" fill="none" stroke="none" />
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
                <p className="text-ui-fg-base text-base font-medium">
                  Connect your Data
                </p>
              </div>
              <p className="text-ui-fg-subtle mt-2 text-sm">
                Inteligir connects to the database and tools your team is
                already using. Combine multiple sources to discover unique
                insights.
              </p>
            </button>
            <button
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => {
                setCurrentTab(2);
              }}
              type="button"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  className="text-ui-fg-subtle h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M0 0h24v24H0z" fill="none" stroke="none" />
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
                <p className="text-ui-fg-base text-lg font-medium">
                  Ask your top questions
                </p>
              </div>
              <p className="text-ui-fg-subtle mt-2 text-sm">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <button
              className="relative z-20 flex w-full flex-col p-4 text-left md:p-8"
              onClick={() => {
                setCurrentTab(3);
              }}
              type="button"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <svg
                  className="text-ui-fg-subtle h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M0 0h24v24H0z" fill="none" stroke="none" />
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path
                    d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"
                    opacity="0.5"
                  />
                  <path d="M12 17v.01" />
                  <path d="M12 14a1.5 1.5 0 1 0 -1.14 -2.474" />
                </svg>
                <p className="text-ui-fg-base text-lg font-medium">
                  Generate custom reports
                </p>
              </div>
              <p className="text-ui-fg-subtle mt-2 text-sm">
                Trade cryptocurrencies and tokens on a decentralized exchange
                for added security and anonymity.
              </p>
            </button>
            <div className="absolute left-0 z-10 hidden h-full w-1/2 duration-300 ease-out md:block">
              <div className="border-ui-fg-base ml-8 h-full w-12 border-b-[3px]" />
            </div>
          </div>
          <div className="content relative hidden w-full items-center justify-center overflow-hidden shadow-sm md:block md:rounded-b-3xl">
            {[1, 2, 3].map(
              (i) =>
                currentTab === i && (
                  <div className="relative" key={i}>
                    <div className="w-full overflow-hidden">
                      <img
                        alt=""
                        className="w-full invert"
                        src={`/screenshots/chart${i}.svg`}
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
