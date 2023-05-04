"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";

function ClientOnly({ children }: { children: ReactNode }) {
  let [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? <Suspense fallback="">{children}</Suspense> : null;
}

export default ClientOnly;
