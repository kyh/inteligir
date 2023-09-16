import { cn } from "~/lib/cn";

type TagProps = {
  color: "green" | "red" | "blue" | "gray";
  children: React.ReactNode;
};

export default function Tag({ color, children }: TagProps) {
  return (
    <div
      className={cn(
        "w-fit rounded-full px-2 py-[1px] text-[0.75rem] font-medium",
        {
          "bg-green-200 text-green-900": color === "green",
          "bg-red-200 text-red-900": color === "red",
          "bg-blue-200 text-blue-900": color === "blue",
          "bg-gray-200 text-gray-900": color === "gray",
        },
      )}
    >
      {children}
    </div>
  );
}
