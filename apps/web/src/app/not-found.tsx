import type { Metadata } from "next";

import "#styles/globals.css";

export const metadata: Metadata = { title: "Page not found" };

const NotFound = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <p>404: This page could not be found.</p>
  </div>
);

export default NotFound;
