import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { saveBlob } from "@repo/ui/lib/save-blob";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";

import { usePageLibrary } from "../cloud/library-context";
import { readFile } from "../cloud/library-files";

export const SaveFile = ({
  label,
  name,
  sha,
  variant = "secondary",
}: {
  label: string;
  name: string;
  sha: string;
  variant?: "ghost" | "secondary";
}) => {
  const { cloud } = usePageLibrary();

  const save = useMutation({
    mutationFn: async () => {
      saveBlob(await readFile(cloud, sha), name);
    },
    onError: () => {
      toast.error("The file couldn't be saved. Check your connection and try again.");
    },
  });

  return (
    <Button
      variant={variant}
      disabled={save.isPending}
      onClick={() => {
        save.mutate();
      }}
    >
      <DownloadIcon />
      {label}
    </Button>
  );
};
