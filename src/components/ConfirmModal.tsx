import { Dialog } from "@headlessui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Button } from "~/components/Button";
import { Modal, type Props as ModalProps } from "~/components/Modal";

type Props = {
  title: React.ReactNode;
  message: React.ReactNode;
} & ModalProps;

export const ConfirmModal = ({ children, title, message, ...rest }: Props) => {
  return (
    <Modal {...rest}>
      <div className="sm:flex sm:items-start">
        <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-800 sm:mx-0 sm:h-10 sm:w-10">
          <ExclamationTriangleIcon
            className="h-6 w-6 text-red-300"
            aria-hidden="true"
          />
        </div>
        <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
          <Dialog.Title as="h3" className="text-lg font-medium leading-6">
            {title}
          </Dialog.Title>
          <div className="mt-2">
            <p className="text-sm text-gray-500">{message}</p>
          </div>
        </div>
      </div>
      <footer className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse sm:gap-2">
        {children}
        <Button className="border-none" onClick={rest.closeModal}>
          Cancel
        </Button>
      </footer>
    </Modal>
  );
};
