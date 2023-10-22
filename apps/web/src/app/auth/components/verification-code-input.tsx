import type { FormEventHandler } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import TextField from "@inteligir/ui/text-field";

const DIGITS = 6;

const VerificationCodeInput = ({
  onValid,
  onInvalid,
}: React.PropsWithChildren<{
  onValid: (code: string) => void;
  onInvalid: () => void;
}>) => {
  const digitsArray = useMemo(
    () => Array.from({ length: DIGITS }, (_, i) => i),
    [],
  );

  const { control, register, watch, setFocus, formState, setValue } = useForm({
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: {
      values: digitsArray.map(() => ({ value: "" })),
    },
  });

  useFieldArray({
    control,
    name: "values",
    shouldUnregister: true,
  });

  const values = watch();

  useEffect(() => {
    if (!formState.isValid) {
      onInvalid();
    }

    const code = values.values.map((value) => value.value).join("");

    if (code.length === DIGITS) {
      onValid(code);
    } else {
      onInvalid();
    }
  }, [onInvalid, onValid, values, formState.isValid]);

  useEffect(() => {
    setFocus("values.0.value");
  }, [setFocus]);

  const onInput: FormEventHandler<HTMLFormElement> = useCallback(
    (target) => {
      const element = target.currentTarget;
      const isValid = element.reportValidity();

      if (isValid) {
        const nextIndex = Number(element.dataset.index) + 1;

        if (nextIndex >= DIGITS) {
          return;
        }

        setFocus(`values.${nextIndex}.value`);
      }
    },
    [setFocus],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLFormElement>) => {
      const pasted = event.clipboardData.getData("text/plain");

      // check if value is numeric
      if (isNumeric(pasted)) {
        const digits = getDigits(pasted, digitsArray);

        digits.forEach((value, index) => {
          setValue(`values.${index}.value`, value);
          setFocus(`values.${index + 1}.value`);
        });
      }
    },
    [digitsArray, setFocus, setValue],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        event.preventDefault();

        const index = Number(event.currentTarget.dataset.inputIndex);

        setValue(`values.${index}.value`, "");
        setFocus(`values.${index - 1}.value`);
      }
    },
    [setFocus, setValue],
  );

  return (
    <div className="flex justify-center space-x-2">
      {digitsArray.map((digit, index) => {
        const c = { ...register(`values.${digit}.value`) };

        return (
          <TextField.Input
            autoComplete="off"
            className="w-10 text-center"
            data-index={digit}
            data-input-index={index}
            key={digit}
            maxLength={1}
            onInput={onInput}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            pattern="[0-9]"
            required
            {...c}
          />
        );
      })}
    </div>
  );
};

export default VerificationCodeInput;

const isNumeric = (pasted: string) => {
  const isNumericRegExp = /^-?\d+$/;

  return isNumericRegExp.test(pasted);
};

const getDigits = (pasted: string, digitsArray: number[]) =>
  pasted.split("").slice(0, digitsArray.length);
