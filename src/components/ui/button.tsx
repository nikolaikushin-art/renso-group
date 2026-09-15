import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Renso button system — Apple-level control language.
 * One coherent family: primary, secondary, outline, ghost, destructive, link.
 * Consistent height, radius, icon alignment, focus, hover, pressed, disabled.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-[13px] font-semibold tracking-[-0.01em]",
    "rounded-full",
    "transition-[background-color,box-shadow,transform,opacity,color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--canvas))]",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.98]",
    "[&_svg]:pointer-events-none [&_svg]:size-[15px] [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-[rgb(var(--accent-deep))] text-white shadow-sm hover:bg-[rgb(var(--accent-deep))]/90 hover:shadow",
        destructive:
          "bg-[rgb(var(--danger))]/90 text-white shadow-sm hover:bg-[rgb(var(--danger))]",
        outline:
          "border border-[rgb(var(--divider))] bg-[rgb(var(--surface))] text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--surface-elevated))] hover:border-[rgb(var(--text-tertiary))]",
        secondary:
          "bg-[rgb(var(--surface-elevated))] text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--divider))]",
        ghost:
          "text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--surface-elevated))] hover:text-[rgb(var(--text-primary))]",
        link:
          "text-[rgb(var(--accent))] underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-[12px]",
        lg: "h-11 px-6 text-[14px]",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ComponentPropsWithRef<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = ({
  ref,
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
};
Button.displayName = "Button";

export { Button, buttonVariants };
