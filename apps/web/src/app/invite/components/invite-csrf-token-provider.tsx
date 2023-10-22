"use client";

import CsrfTokenContext from "@/lib/csrf/csrf-provider";

const InviteCsrfTokenProvider = (
  props: React.PropsWithChildren<{
    csrfToken: string | null;
  }>,
) => {
  return (
    <CsrfTokenContext.Provider value={props.csrfToken}>
      {props.children}
    </CsrfTokenContext.Provider>
  );
};

export default InviteCsrfTokenProvider;
