import { useCallback, useEffect, useState } from "react";

export const useLocalStorage = <T>(key: string, initialValue: T): [T, (value: T) => void] => {
  const [storedValue, setStoredValue] = useState(initialValue);

  // Sync state from localStorage - valid Effect (external browser storage API)
  useEffect(() => {
    // Retrieve from localStorage
    const item = window.localStorage.getItem(key);

    if (item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- valid: syncing from external localStorage
      setStoredValue(JSON.parse(item));
    }
  }, [key]);

  const setValue = (value: T) => {
    // Save state
    setStoredValue(value);
    // Save to localStorage
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  return [storedValue, setValue];
};

export const useInitialLocalStorage = <T>(
  key: string,
  defaultValue: T,
): [T | undefined, (value: T) => void] => {
  const [initialValue, setInitialValue] = useState<T | undefined>();

  // Sync initial value from localStorage - valid Effect (external browser storage API)
  useEffect(() => {
    const item = window.localStorage.getItem(key);

    if (item) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- valid: syncing from external localStorage
      setInitialValue(JSON.parse(item));
    } else {
      setInitialValue(defaultValue);
    }
  }, [key, defaultValue]);

  const setValue = useCallback(
    (value: T) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    [key],
  );

  return [initialValue, setValue];
};
