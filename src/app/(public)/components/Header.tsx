"use client";

import { cn } from "~/lib/cn";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import Logo from "~/components/ui/Logo";
import { CTAButton } from "./CTAButton";

export default function Header({
  className,
  fullWidth = false,
}: {
  className?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const logoHref = "/";

  return (
    <section className="fixed z-50 w-full overflow-hidden relatve backdrop-blur-2xl">
      <div className="relative w-full mx-auto max-w-7xl">
        <div className="relative flex flex-col w-full px-8 py-5 mx-auto md:items-center md:justify-between md:flex-row md:px-12 lg:px-32">
          <div className="flex flex-row items-center justify-between text-white lg:justify-start">
            <a href="/" className="inline-flex items-center gap-3">
              <span>
                <svg
                  width="30"
                  height="32"
                  viewBox="0 0 60 62"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M32.9219 8.84226C32.9219 5.86885 36.5379 4.40339 38.608 6.53787L57.6821 26.2056C58.9383 27.5009 59.6408 29.2344 59.6408 31.0388V53.8041C59.6408 56.7775 56.0248 58.243 53.9547 56.1085L34.8806 36.4407C33.6244 35.1454 32.9219 33.4119 32.9219 31.6075V8.84226Z"
                    fill="#737373"
                  />
                  <path
                    d="M16.3633 8.19578C16.3633 5.22237 19.9793 3.75691 22.0494 5.89139L40.842 25.2689C42.2788 26.7503 43.0823 28.733 43.0823 30.7967V53.1576C43.0823 56.131 39.4662 57.5965 37.3961 55.462L18.322 35.7942C17.0658 34.4989 16.3633 32.7654 16.3633 30.9611V8.19578Z"
                    fill="#8F8F8F"
                  />
                  <path
                    d="M0.359375 8.84226C0.359375 5.86885 3.97542 4.40339 6.04548 6.53787L25.1196 26.2056C26.3758 27.5009 27.0783 29.2344 27.0783 31.0388V53.8041C27.0783 56.7775 23.4623 58.243 21.3922 56.1085L2.3181 36.4407C1.06191 35.1454 0.359375 33.4119 0.359375 31.6075V8.84226Z"
                    fill="#ABABAB"
                  />
                </svg>
              </span>
              <span className="font-bold text-xl uppercase"> &nbsp;brand</span>
            </a>
            <button
              // @click="open = !open"
              className="inline-flex items-center justify-center p-2 text-white hover:text-indigo-400 focus:outline-none focus:text-white md:hidden"
            >
              <svg
                className="w-6 h-6"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  // :className="{'hidden': open, 'inline-flex': !open }"
                  className="inline-flex"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                ></path>
                <path
                  // :className="{'hidden': !open, 'inline-flex': open }"
                  className="hidden"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                ></path>
              </svg>
            </button>
          </div>
          <nav
            // :className="{'flex': open, 'hidden': !open}"
            className="flex-col items-center flex-grow hidden md:pb-0 md:flex md:justify-end md:flex-row"
          >
            <a
              className="px-2 py-2 text-sm font-normal text-brand-300 lg:px-6 md:px-3 hover:text-white lg:ml-auto"
              href="/"
            >
              Overview
            </a>
            <a
              className="px-2 py-2 text-sm font-normal text-brand-300 lg:px-6 md:px-3 hover:text-white"
              href="/system/styleguide"
            >
              Styleguide
            </a>
            <a
              href="https://lexingtonthemes.lemonsqueezy.com/checkout/buy/f0a11cac-e5c4-4cee-9a11-631749fd6647"
              className="rounded-lg px-4 py-2 text-sm transition-all flex items-center justify-center text-white bg-gradient-to-b from-white/[.105] to-white/[.15] hover:to-white/[.25] h-8 ring-1 ring-inset ring-white/10"
            >
              Buy brand
            </a>
          </nav>
        </div>
      </div>
    </section>
  );
}

export function BlogHeader() {
  return (
    <Header className="fixed top-0 w-full border-b border-gray-200 bg-white" />
  );
}

function Links() {
  return (
    <>
      {["blog", "docs", "changelog"].map((link) => (
        <Link key={link} href={`/${link}`}>
          <Button variant="ghost" className="text-base font-normal capitalize">
            {link}
          </Button>
        </Link>
      ))}
    </>
  );
}
