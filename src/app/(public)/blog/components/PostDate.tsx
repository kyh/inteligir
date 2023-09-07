import { cn } from "~/lib/cn";
import dayjs from "dayjs";

export default function PostDate({
  timeString,
  className,
}: {
  timeString: string;
  className?: string;
}) {
  return (
    <span className={cn("text-gray-500", className)}>
      {dayjs(timeString).format("d MMMM yyyy")}
    </span>
  );
}
