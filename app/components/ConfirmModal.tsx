import type { Props as ModalProps } from "~/components/Modal";
import { Dialog } from "@headlessui/react";
import { FiAlertTriangle } from "react-icons/fi";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/Button";

type Props = {
  title: React.ReactNode;
  message: React.ReactNode;
} & ModalProps;

export const ConfirmModal = ({ children, title, message, ...rest }: Props) => {
  return (
    <Modal {...rest}>
      <div className="sm:flex sm:items-start">
        <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-800 sm:mx-0 sm:h-10 sm:w-10">
          <FiAlertTriangle
            className="h-6 w-6 text-red-300"
            aria-hidden="true"
          />
        </div>
        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
          <Dialog.Title as="h3" className="text-lg leading-6 font-medium">
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
