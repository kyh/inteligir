import { useContext } from "react";
import CsrfTokenContext from "~/lib/contexts/csrf";

const useCsrfToken = () => {
  const token = useContext(CsrfTokenContext);

  return token || "";
};

export default useCsrfToken;
