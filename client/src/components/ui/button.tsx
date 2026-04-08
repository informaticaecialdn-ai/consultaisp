import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-mono text-[11px] tracking-[0.06em] border-[0.5px] cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-navy)] text-white border-[var(--color-navy)] hover:bg-[var(--color-steel)]",
        destructive:
          "bg-[var(--color-danger)] text-white border-[var(--color-danger)] hover:opacity-90",
        outline:
          "bg-transparent text-[var(--color-navy)] border-[var(--color-navy)] hover:bg-[var(--color-navy-bg)]",
        secondary:
          "bg-transparent text-[var(--color-navy)] border-[var(--color-navy)] hover:bg-[var(--color-navy-bg)]",
        ghost:
          "bg-transparent text-[var(--color-muted)] border-transparent hover:bg-[var(--color-tag-bg)]",
      },
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-9 px-3 text-[10px] [@media(pointer:coarse)]:min-h-11",
        lg: "min-h-11 px-8",
        icon: "h-10 w-10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
