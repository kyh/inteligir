import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/24/outline";

function SelectorIcon(
  props: React.PropsWithChildren<{
    className?: string;
  }>
) {
  return (
    <div className={`flex flex-col ${props.className ?? ""}`}>
      <ChevronUpIcon className="relative top-[0.1rem] h-3" />
      <ChevronDownIcon className="relative bottom-[0.1rem] h-3" />
    </div>
  );
}

export default SelectorIcon;
