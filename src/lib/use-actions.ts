import { useState } from "react";

type AsyncFunction = (...args: any) => Promise<any>;

export function useServerAction<T extends AsyncFunction>(action: T) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null | undefined>(null);
  const [data, setData] = useState<Awaited<ReturnType<T>> | null | undefined>(
    null
  );

  async function mutate(...payload: Parameters<T>) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await action(payload);
      setData(res);
    } catch (e: any) {
      setError(e);
    }

    setLoading(false);
  }

  return {
    data,
    loading,
    error,
    mutate,
  };
}
