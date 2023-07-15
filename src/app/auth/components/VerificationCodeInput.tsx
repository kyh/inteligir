import { useCallback, useEffect, useMemo, type FormEventHandler } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { TextField } from "~/components/TextField";

const DIGITS = 6;

const VerificationCodeInput = (
  {
    onValid,
    onInvalid,
  }: React.PropsWithChildren<{
    onValid: (code: string) => void;
    onInvalid: () => void;
  }>
) => {
  const digitsArray = useMemo(
    () => Array.from({ length: DIGITS }, (_, i) => i),
    []
  );

  const { control, register, watch, setFocus, formState } = useForm({
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

  const onChange: FormEventHandler<HTMLFormElement> = useCallback(
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
    [setFocus]
  );

  return (
    <div className="flex justify-center space-x-2">
      {digitsArray.map((digit) => {
        const control = { ...register(`values.${digit}.value`) };

        return (
          <TextField.Input
            autoComplete="off"
            className="w-10 text-center"
            data-index={digit}
            pattern="[0-9]"
            required
            key={digit}
            maxLength={1}
            {...control}
          />
        );
      })}
    </div>
  );
};

export default VerificationCodeInput;
