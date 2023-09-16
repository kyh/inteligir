import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function ConfirmSettingsCard({
  alert,
  title,
  description,
  button,
  children,
}: {
  title: string;
  description: string;
  button: {
    name: string;
    onClick: () => void;
    loading: boolean;
    variant?: "destructive" | "link" | "outline" | "ghost";
  };
  alert: {
    title: string;
    description: string;
  };
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex flex-col items-start justify-end gap-y-2 rounded-md border bg-white">
      <div className="px-6 py-4">
        <div className="mb-3 text-lg font-medium">{title}</div>
        <p className="mb-3">{description}</p>
        {children}
      </div>
      <div className="flex w-full justify-end rounded-b-md border-t bg-gray-50 px-6 py-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="self-end" variant={button.variant}>
              {button.name}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{alert.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {alert.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                className="self-end"
                disabled={button.loading}
                onClick={button.onClick}
              >
                {button.loading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {button.name}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
