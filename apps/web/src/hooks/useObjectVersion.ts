import { useEffect, useRef, useState } from "react";

export const useObjectVersion = (obj: unknown): number => {
  const [version, setVersion] = useState(0);
  const prevObjRef = useRef(obj);

  // Track version changes in Effect (not during render)
  useEffect(() => {
    if (prevObjRef.current !== obj) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- valid: tracking object identity changes
      setVersion((v) => v + 1);
      prevObjRef.current = obj;
    }
  }, [obj]);

  return version;
};
