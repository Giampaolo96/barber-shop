import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Pulsanti sui token del tema (docs/DESIGN.md): angoli del tema, bordo di 1px, nessuna ombra.
// Il pieno nero è l'azione principale; il bordo nero un'azione secondaria. Disabilitato con i
// colori dedicati, non con l'opacità. Nei temi con la luce l'azione principale è accesa (glow) e il
// bagliore delle altre cresce al passaggio (glow-hover); in un tema senza luce le due classi non hanno effetto.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border text-sm font-medium whitespace-nowrap select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:border-disabled disabled:bg-disabled disabled:text-ink-disabled aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "glow border-ink bg-ink text-surface hover:bg-surface hover:text-ink active:bg-ink active:text-surface",
        outline: "glow-hover border-ink bg-surface text-ink hover:bg-ink hover:text-surface active:bg-ink active:text-surface aria-expanded:bg-ink aria-expanded:text-surface",
        secondary: "glow-hover border-ink bg-surface text-ink hover:bg-disabled active:bg-ink active:text-surface",
        ghost: "transition-colors border-transparent hover:bg-disabled aria-expanded:bg-disabled",
        destructive:
          "glow-hover border-destructive bg-surface text-destructive hover:bg-destructive hover:text-surface focus-visible:outline-destructive",
        "destructive-quiet":
          "glow-hover border-ink bg-surface text-ink hover:border-destructive hover:text-destructive focus-visible:border-destructive focus-visible:text-destructive focus-visible:outline-destructive",
        link: "transition-colors border-transparent text-ink underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "h-11 gap-2 px-4",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 px-3 md:h-9 [&_svg:not([class*='size-'])]:size-3.5",
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
