import { useCallback } from "react";
import Trans from "ui/components/Trans";
import Modal from "ui/components/Modal";
import ReauthenticationForm from "@/app/auth/components/ReauthenticationForm";

const ReauthenticationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}> = ({ isOpen, setIsOpen }) => {
  const onSuccess = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  return (
    <Modal
      closeButton={false}
      heading={<Trans i18nKey="auth:reauthenticate" />}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="my-4">
        <p>
          <Trans i18nKey="auth:reauthenticateDescription" />
        </p>
      </div>

      <ReauthenticationForm onSuccess={onSuccess} />
    </Modal>
  );
};

export default ReauthenticationModal;
