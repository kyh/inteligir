import GlobalLoadingIndicator from "@/components/GlobalLoadingIndicator";
import Trans from "ui/components/Trans";

const Loading = () => {
  return (
    <GlobalLoadingIndicator>
      <Trans i18nKey="common:loading" />
    </GlobalLoadingIndicator>
  );
};

export default Loading;
