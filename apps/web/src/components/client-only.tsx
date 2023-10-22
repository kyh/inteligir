"use client";

import type { ReactNode } from "react";
import { Suspense, useEffect, useState } from "react";

const ClientOnly = ({ children }: { children: ReactNode }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? <Suspense fallback="">{children}</Suspense> : null;
};

export default ClientOnly;
