import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "whitespace-nowrap inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.06em] transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-navy-bg)] text-[var(--color-navy)]",
        secondary: "border-transparent bg-[var(--color-tag-bg)] text-[var(--color-muted)]",
        destructive:
          "border-transparent bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
        outline: "border-[0.5px] border-[var(--color-border)] text-[var(--color-muted)]",
        navy: "border-transparent bg-[var(--color-navy-bg)] text-[var(--color-navy)]",
        gold: "border-transparent bg-[var(--color-gold-bg)] text-[var(--color-gold)]",
        danger: "border-transparent bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
        success: "border-transparent bg-[var(--color-success-bg)] text-[var(--color-success)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
