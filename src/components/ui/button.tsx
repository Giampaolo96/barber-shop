import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Pulsanti sui token del tema (docs/DESIGN.md): angoli del tema, bordo di 1px, nessuna ombra.
// Il pieno nero è l'azione principale; il bordo nero un'azione secondaria. Disabilitato con i
// colori dedicati, non con l'opacità.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border text-sm font-medium whitespace-nowrap transition-colors select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:border-disabled disabled:bg-disabled disabled:text-ink-disabled aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-ink bg-ink text-surface hover:bg-surface hover:text-ink",
        outline: "border-ink bg-surface text-ink hover:bg-ink hover:text-surface aria-expanded:bg-ink aria-expanded:text-surface",
        secondary: "border-line bg-surface text-ink hover:border-ink",
        ghost: "border-transparent hover:bg-disabled aria-expanded:bg-disabled",
        destructive:
          "border-destructive bg-surface text-destructive hover:bg-destructive hover:text-surface focus-visible:outline-destructive",
        link: "border-transparent text-ink underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "h-11 gap-2 px-4",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
