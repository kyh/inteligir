import { useCallback } from "react";
import Trans from "@inteligir/ui/trans";
import Modal from "@inteligir/ui/modal";
import ReauthenticationForm from "@/app/auth/components/reauthentication-form";

const ReauthenticationModal: React.FC<{
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}> = ({ isOpen, setIsOpen }) => {
  const onSuccess = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  return (
    (<Modal
      closeButton={false}
      heading={Reauthenticate}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="my-4">
        <p>
          For security reasons, we need you to re-authenticate
        </p>
      </div>
      <ReauthenticationForm onSuccess={onSuccess} />
    </Modal>)
  );
};

export default ReauthenticationModal;
