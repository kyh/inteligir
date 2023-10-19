import PageLoadingIndicator from "ui/components/PageLoadingIndicator";
import Trans from "ui/components/Trans";

const Loading = () => {
  return (
    <div className="flex h-full items-center py-8">
      <PageLoadingIndicator fullPage={false}>
        <Trans i18nKey="common:loading" />
      </PageLoadingIndicator>
    </div>
  );
};

export default Loading;
