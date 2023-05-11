import { useCallback } from "react";
import Modal from "~/components/Modal";
import ReauthenticationForm from "~/app/auth/components/ReauthenticationForm";

const ReauthenticationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}> = ({ isOpen, setIsOpen }) => {
  const onSuccess = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  return (
    <Modal
      heading={Reauthenticate}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      closeButton={false}
    >
      <div className="my-4">
        <p>For security reasons, we need you to re-authenticate</p>
      </div>

      <ReauthenticationForm onSuccess={onSuccess} />
    </Modal>
  );
};

export default ReauthenticationModal;
