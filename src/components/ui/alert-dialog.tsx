"use client";

import * as React from "react";
import { AlertDialog as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Dialogo di conferma (role="alertdialog") sui token del tema (docs/DESIGN.md): angoli del tema,
// bordo di 1px, nessuna ombra. Il focus parte dall'azione meno distruttiva ("Annulla"). Il portal
// monta il dialogo in <body>, fuori dal layout: `area` riporta l'area (es. "admin") e il suo stile.

const AlertDialog = Primitive.Root;
const AlertDialogTitle = Primitive.Title;
const AlertDialogCancel = Primitive.Cancel;

function AlertDialogContent({
  className,
  children,
  area,
  ...props
}: React.ComponentProps<typeof Primitive.Content> & { area?: string }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay data-area={area} className="fixed inset-0 z-50 bg-(--scrim)" />
      <Primitive.Content
        data-area={area}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-md border border-ink bg-surface p-5 text-ink",
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description className={cn("text-sm", className)} {...props} />;
}

export {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};
