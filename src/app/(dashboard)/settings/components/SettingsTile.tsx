import Heading from "~/components/Heading";
import If from "~/components/If";

const SettingsTile: React.FCC<{
  heading?: string | React.ReactNode;
  subHeading?: string | React.ReactNode;
  actions?: React.ReactNode;
}> = ({ children, heading, subHeading, actions }) => {
  return (
    <div className="flex w-full flex-col space-y-6">
      <div className="flex flex-col space-y-1.5">
        <div className="flex items-center justify-between">
          <If condition={heading}>
            <div className="flex flex-col space-y-1">
              <Heading type={4}>
                <span className="font-medium">{heading}</span>
              </Heading>

              <If condition={subHeading}>
                <p className="text-zinc-500 dark:text-zinc-400">{subHeading}</p>
              </If>
            </div>
          </If>

          <If condition={actions}>{actions}</If>
        </div>
      </div>

      <div className="rounded-lg border border-border p-2.5 lg:p-6">
        {children}
      </div>
    </div>
  );
};

export default SettingsTile;
