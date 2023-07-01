"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEventHandler,
} from "react";
import { UploadCloudIcon, XIcon } from "lucide-react";
import { Button } from "~/components/Button";
import If from "~/components/If";
import { TextField } from "~/components/TextField";

type Props = Omit<React.InputHTMLAttributes<unknown>, "value"> & {
  image?: string | null;
  onClear?: () => void;
};

const IMAGE_SIZE = 22;

const ImageUploadInput = forwardRef<React.ElementRef<"input">, Props>(
  function ImageUploadInputComponent(
    { children, image, onClear, onInput, ...props },
    forwardedRef
  ) {
    const localRef = useRef<HTMLInputElement>();

    const [state, setState] = useState({
      image,
      fileName: "",
    });

    const onInputChange = useCallback(
      (e: FormEvent<HTMLInputElement>) => {
        e.preventDefault();

        const files = e.currentTarget.files;

        if (files?.length) {
          const file = files[0];
          const data = URL.createObjectURL(file);

          setState({
            image: data,
            fileName: file.name,
          });
        }

        if (onInput) {
          onInput(e);
        }
      },
      [onInput]
    );

    const imageRemoved: MouseEventHandler = useCallback(
      (e) => {
        e.preventDefault();

        setState({
          image: "",
          fileName: "",
        });

        if (localRef.current) {
          localRef.current.value = "";
        }

        if (onClear) {
          onClear();
        }
      },
      [onClear]
    );

    const setRef = useCallback(
      (input: HTMLInputElement) => {
        localRef.current = input;

        if (typeof forwardedRef === "function") {
          forwardedRef(localRef.current);
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      setState((state) => ({ ...state, image }));
    }, [image]);

    return (
      <label
        id="image-upload-input"
        tabIndex={0}
        className="\n        focus:ring-2\n relative flex h-10 cursor-pointer rounded-md border border-dashed border-zinc-200 bg-white px-3 py-2 outline-none ring-offset-1 transition-all hover:bg-zinc-50        focus:ring-emerald-200 dark:border-zinc-200 dark:bg-zinc-400 dark:hover:border-zinc-100 dark:focus:ring-emerald-500/70 dark:focus:ring-offset-zinc-400"
      >
        <input
          {...props}
          ref={setRef}
          className="hidden"
          type="file"
          onInput={onInputChange}
          accept="image/*"
          aria-labelledby="image-upload-input"
        />

        <div className="flex items-center space-x-4">
          <div className="flex">
            <If condition={!state.image}>
              <UploadCloudIcon className="h-5 text-zinc-500 dark:text-zinc-100" />
            </If>
            <If condition={state.image}>
              <img
                loading="lazy"
                style={{
                  width: IMAGE_SIZE,
                  height: IMAGE_SIZE,
                }}
                className="object-contain"
                width={IMAGE_SIZE}
                height={IMAGE_SIZE}
                src={state.image as string}
                alt={props.alt ?? ""}
              />
            </If>
          </div>

          <If condition={!state.image}>
            <div className="flex flex-auto">
              <TextField.Label as="span" className="cursor-pointer text-xs">
                {children}
              </TextField.Label>
            </div>
          </If>

          <If condition={state.image as string}>
            <div className="flex flex-auto">
              <If
                condition={state.fileName}
                fallback={
                  <TextField.Label
                    as="span"
                    className="cursor-pointer truncate text-xs"
                  >
                    {children}
                  </TextField.Label>
                }
              >
                <TextField.Label as="span" className="truncate text-xs">
                  {state.fileName}
                </TextField.Label>
              </If>
            </div>
          </If>

          <If condition={state.image}>
            <Button className="!h-5 !w-5" onClick={imageRemoved}>
              <XIcon className="h-4" />
            </Button>
          </If>
        </div>
      </label>
    );
  }
);
export default ImageUploadInput;
