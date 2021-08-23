import { forwardRef, ReactNode } from "react";
import tw, { styled } from "twin.macro";

interface Props {
  children?: ReactNode;
  size?: keyof typeof variants["size"];
  variant?: keyof typeof variants["variant"];
  shape?: keyof typeof variants["shape"];
}

type Ref = ReactNode | HTMLElement | string;

const base = tw`text-gray-900 bg-transparent inline-flex items-center border border-transparent rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-800 transition-all`;

const variants = {
  size: {
    xs: tw`px-2.5 py-1.5 text-xs`,
    sm: tw`px-3 py-2 text-sm`,
    md: tw`px-4 py-2 text-sm`,
    lg: tw`px-4 py-2 text-base`,
    xl: tw`px-6 py-3 text-base`,
  },
  variant: {
    primary: tw`text-white bg-gray-900 hover:bg-gray-800`,
    secondary: tw`bg-gray-100 hover:bg-gray-200`,
    outline: tw`hover:bg-gray-50 border-gray-600`,
    ghost: tw`hover:bg-gray-50`,
    link: tw`hover:underline p-0`,
  },
  shape: {
    default: tw`rounded`,
    rounded: tw`rounded-full`,
  },
};

const StyledButton = styled.button({
  ...base,
  variants,
  defaultVariants: {
    size: "md",
    variant: "primary",
    shape: "default",
  },
});

export const Button = forwardRef<Ref, Props>(function Button({ ...rest }, ref) {
  return <StyledButton ref={ref} {...rest} />;
});
