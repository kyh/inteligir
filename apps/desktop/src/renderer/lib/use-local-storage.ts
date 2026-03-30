import { useEffect, useMemo, useRef, useState } from "react";

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): [T, React.Dispatch<React.SetStateAction<T | undefined>>] {
  const rawValueRef = useRef<string | null>(null);

  const [value, setValue] = useState<T | undefined>(() => {
    try {
      rawValueRef.current = window.localStorage.getItem(key);
      return rawValueRef.current ? (JSON.parse(rawValueRef.current) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      if (value !== undefined) {
        const newValue = JSON.stringify(value);
        rawValueRef.current = newValue;
        window.localStorage.setItem(key, newValue);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  }, [key, value]);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== window.localStorage) return;
      if (e.newValue !== rawValueRef.current) {
        rawValueRef.current = e.newValue;
        setValue(e.newValue ? (JSON.parse(e.newValue) as T) : undefined);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [key]);

  return [value ?? defaultValue, setValue];
}
