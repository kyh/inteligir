import { forwardRef, ReactNode } from "react";
import tw, { styled } from "twin.macro";

interface Props {
  children?: ReactNode;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

type Ref = ReactNode | HTMLElement | string;

const StyledButton = styled.button({
  // base styles
  ...tw`inline-flex items-center`,
  // theme styles
  ...tw`font-medium text-white bg-indigo-600 border border-transparent rounded shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`,
  variants: {
    size: {
      xs: tw`px-2.5 py-1.5 text-xs`,
      sm: tw`px-3 py-2 text-sm`,
      md: tw`px-4 py-2 text-sm`,
      lg: tw`px-4 py-2 text-base`,
      xl: tw`px-6 py-3 text-base`,
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const Button = forwardRef<Ref, Props>(function Button({ ...rest }, ref) {
  return <StyledButton ref={ref} {...rest} />;
});

export default Button;
