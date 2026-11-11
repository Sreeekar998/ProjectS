import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

// One button voice for the product.
//   primary   the ordinary committing action (ink, confident, never shouting)
//   accent    the one stage-advancing action on a page (sun): Confirm profile,
//             Confirm & continue, Approve, Collect
//   secondary a bordered sheet button
//   ghost     row actions that should not compete with the content
//   subtle    a muted filled button for toolbars
//   danger    destructive
export const buttonVariants = cva(
  "focus-ring inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink-950 text-white hover:bg-ink-800 active:bg-ink-900",
        accent: "bg-sun-400 text-ink-950 shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] hover:bg-sun-300 active:bg-sun-500",
        secondary: "border border-ink-200 bg-white text-ink-900 hover:border-ink-300 hover:bg-paper",
        ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-950",
        danger: "bg-danger-500 text-white hover:bg-danger-600",
        subtle: "bg-ink-100 text-ink-800 hover:bg-ink-200",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
