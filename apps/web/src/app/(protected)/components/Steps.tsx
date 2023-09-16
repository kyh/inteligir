"use client";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IconCircle from "./IconCircle";

export type StepProps = {
  title: string;
  fieldType: "text";
  placeholder: string;
  onSubmit?: (value: string) => Promise<void>;
  loading?: boolean;
  icon: React.ReactNode;
};

export default function Steps({
  title,
  icon,
  fieldType,
  placeholder,
  onSubmit,
  loading,
}: StepProps) {
  const [input, setInput] = useState("");
  const step = { title, fieldType, placeholder };
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      await onSubmit?.(input);
      setInput("");
    },
    [onSubmit, input]
  );

  return (
    <div className="w-full max-w-lg">
      <IconCircle>{icon}</IconCircle>
      <h2 className="mb-8 mt-4 text-xl font-semibold lg:text-3xl">
        {step.title}
      </h2>
      <form
        className="flex max-w-[360px] flex-col items-start gap-y-6"
        onSubmit={handleSubmit}
      >
        {step.fieldType === "text" && (
          <Input
            key={title}
            autoFocus
            placeholder={step.placeholder}
            className="w-full"
            onChange={(e) => setInput(e.target.value)}
          />
        )}
        <Button className="w-full" disabled={loading || !input}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Next
        </Button>
      </form>
    </div>
  );
}
