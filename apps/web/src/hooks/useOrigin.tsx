import { useMounted } from "@/registry/hooks/use-mounted";

export const useOrigin = () => {
  const mounted = useMounted();

  if (!mounted) {
    return "";
  }

  return window.location.origin ?? "";
};
