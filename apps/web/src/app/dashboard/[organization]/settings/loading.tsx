import GlobalLoadingIndicator from "@/components/global-loading-indicator";
import Trans from "ui/components/trans";

const Loading = () => {
  return (
    <GlobalLoadingIndicator>
      <Trans i18nKey="common:loading" />
    </GlobalLoadingIndicator>
  );
};

export default Loading;
