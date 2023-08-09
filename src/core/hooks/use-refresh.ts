import { useCallback } from "react";
import { useRouter } from "next/navigation";

const useRefresh = () => {
  const router = useRouter();

  return useCallback(() => {
    router.refresh();
  }, [router]);
};

export default useRefresh;
