import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog, DialogContent, DialogTitle } from "~/components/Dialog";
import { If } from "~/components/If";

const Modal: React.FC<
  React.PropsWithChildren<{
    heading: string | React.ReactNode;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => unknown;
    closeButton?: boolean;
  }>
> & {
  CancelButton: typeof CancelButton;
} = ({ isOpen, setIsOpen, closeButton, heading, children }) => {
  const useCloseButton = closeButton ?? true;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (useCloseButton && !open) {
          setIsOpen(false);
        }
      }}
    >
      <DialogContent>
        <div className="h-full min-h-screen px-4 text-center">
          <span
            className="inline-block h-screen align-middle"
            aria-hidden="true"
          >
            &#8203;
          </span>
          <div className="dark:bg-dark-800 inline-block max-h-[90%] w-full max-w-xl transform overflow-auto rounded-xl bg-white p-6 text-left align-middle shadow-xl transition-all">
            <div className={"flex flex-col space-y-4"}>
              <div className="flex items-center">
                <DialogTitle className="flex w-full text-xl font-semibold text-current">
                  <span className={"max-w-[90%] truncate"}>{heading}</span>
                </DialogTitle>
              </div>

              <div className="relative">{children}</div>

              <If condition={useCloseButton}>
                <DialogPrimitiveClose asChild>
                  <Button
                    className={"absolute right-4 top-0 flex items-center"}
                    onClick={() => setIsOpen(false)}
                  >
                    <XIcon className={"h-6"} />
                    <span className="sr-only">Close</span>
                  </Button>
                </DialogPrimitiveClose>
              </If>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Modal;

function CancelButton<Props extends React.ButtonHTMLAttributes<unknown>>(
  props: Props,
) {
  return (
    <Button
      type={"button"}
      data-cy={"close-modal-button"}
      color={"transparent"}
      {...props}
    >
      Cancel
    </Button>
  );
}

Modal.CancelButton = CancelButton;
