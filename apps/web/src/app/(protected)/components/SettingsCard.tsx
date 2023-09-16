import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function SettingsCard({
  title,
  description,
  button,
  children,
}: {
  title: string;
  description: string;
  button: {
    name: string;
    variant?: "destructive" | "link" | "outline" | "ghost";
    onClick: () => void;
    loading: boolean;
  };
  children?: React.ReactNode;
}) {
  return (
    <form
      className="flex flex-col items-start justify-end gap-y-2 rounded-md border bg-white"
      onSubmit={(e) => {
        e.preventDefault();

        button.onClick();
      }}
    >
      <div className="p-4 md:px-6">
        <div className="mb-3 text-lg font-medium">{title}</div>
        <p className="mb-3">{description}</p>
        {children}
      </div>
      <div className="flex w-full justify-end rounded-b-md border-t bg-gray-50 px-6 py-3">
        <Button
          className="self-end"
          variant={button.variant}
          disabled={button.loading}
        >
          {button.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {button.name}
        </Button>
      </div>
    </form>
  );
}
