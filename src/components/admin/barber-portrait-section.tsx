"use client";

import { startTransition, useActionState, useState } from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { FormStatus } from "@/components/admin/form-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { removeBarberPhoto, uploadBarberPhoto } from "@/lib/admin/barber-photo-actions";
import type { BarberPhotoRemoveState, BarberPhotoState } from "@/lib/admin/barber-photo-actions";
import { PORTRAIT_SIZE, encodePortrait } from "@/lib/barbers/portrait-encoding";
import { cn } from "@/lib/utils";

const t = it.admin.barbers;

/** Esito della preparazione nel browser: decodifica non riuscita o codifica non riuscita. */
type ResizeResult = { blob: Blob } | { failure: "not_image" | "encode_failed" };

/** Decodifica il file con il browser; null se non sa leggerlo (es. HEIC su Chrome desktop). */
const decodeImage = async (url: string): Promise<HTMLImageElement | null> => {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return image.naturalWidth > 0 ? image : null;
  } catch {
    return null;
  }
};

/** Ritaglio quadrato al centro, 512×512, in WebP o (Safari iOS) JPEG. */
async function resizePortrait(file: File): Promise<ResizeResult> {
  // L'URL resta valido fino al disegno: Safari può scartare una bitmap grande e ricaricarla.
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(url);
    if (!image) return { failure: "not_image" };

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = PORTRAIT_SIZE;
    canvas.height = PORTRAIT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return { failure: "encode_failed" };
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      PORTRAIT_SIZE,
      PORTRAIT_SIZE,
    );
    const blob = await encodePortrait(
      (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
    );
    return blob ? { blob } : { failure: "encode_failed" };
  } catch {
    // Canvas o codifica senza memoria (iOS con foto molto grandi).
    return { failure: "encode_failed" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const uploadMessages: Partial<Record<string, string>> = {
  too_large: t.portraitTooLarge,
  not_image: t.portraitNotImage,
  encode_failed: t.portraitEncodeFailed,
};

const initialUpload: BarberPhotoState = { status: "idle" };
const initialRemove: BarberPhotoRemoveState = { status: "idle" };

type Prepared = { id: number; blob: Blob; previewUrl: string; fileName: string };

/**
 * Scelta → anteprima del ritaglio → "Salva ritratto". La foto si prepara nel browser appena
 * scelta, così l'anteprima mostra esattamente il quadrato che verrà salvato.
 */
function UploadForm({ barberId, hasPhoto }: { barberId: string; hasPhoto: boolean }) {
  const [state, formAction, pending] = useActionState(uploadBarberPhoto, initialUpload);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [sentId, setSentId] = useState<number | null>(null);
  const [localFailure, setLocalFailure] = useState<"not_image" | "encode_failed" | null>(null);
  const [preparing, setPreparing] = useState(false);

  const replacePrepared = (next: Prepared | null) => {
    setPrepared((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return next;
    });
  };

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Svuotato subito: scegliere di nuovo lo stesso file rifà l'anteprima.
    event.target.value = "";
    if (!file || file.size === 0) return;

    setPreparing(true);
    let result: ResizeResult;
    try {
      result = await resizePortrait(file);
    } finally {
      setPreparing(false);
    }
    // Il browser non ha potuto preparare il file: niente anteprima e niente invio.
    if ("failure" in result) {
      setLocalFailure(result.failure);
      replacePrepared(null);
      return;
    }
    setLocalFailure(null);
    replacePrepared({ id: Date.now(), blob: result.blob, previewUrl: URL.createObjectURL(result.blob), fileName: file.name });
  }

  function save() {
    if (!prepared) return;
    const { blob } = prepared;
    const data = new FormData();
    data.set("barberId", barberId);
    data.set("photo", new File([blob], `ritratto.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type }));
    setSentId(prepared.id);
    startTransition(() => formAction(data));
  }

  // Dopo un salvataggio riuscito l'anteprima lascia il posto al ritratto vero.
  const saved = !pending && state.status === "saved" && sentId === prepared?.id;
  const choice = saved ? null : prepared;
  // L'esito del server vale solo per la foto inviata: una scelta nuova riparte da zero.
  const status = localFailure ?? (choice && sentId !== choice.id ? "idle" : state.status);
  const message = uploadMessages[status];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/*"
          onChange={choose}
          disabled={preparing || pending}
          className="peer sr-only"
        />
        <label
          htmlFor="photo"
          className={cn(
            buttonVariants({ variant: choice ? "outline" : "default" }),
            "cursor-pointer self-start peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:cursor-default",
          )}
        >
          {t.portraitLabel}
        </label>
        <p className="text-sm text-muted-foreground">{t.portraitHint}</p>
      </div>
      {preparing && (
        <p role="status" className="text-sm">
          {t.portraitPreparing}
        </p>
      )}
      {choice && (
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={choice.previewUrl}
            alt={t.portraitPreviewAlt}
            width={PORTRAIT_SIZE}
            height={PORTRAIT_SIZE}
            className="aspect-square w-32 shrink-0 border border-ink object-cover grayscale"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="truncate text-sm font-medium">{choice.fileName}</p>
            <p className="text-sm text-muted-foreground">{t.portraitPreviewHint}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={pending}>
                {pending ? t.portraitWorking : t.portraitUpload}
              </Button>
              <Button type="button" variant="outline" onClick={() => replacePrepared(null)} disabled={pending}>
                {t.portraitCancel}
              </Button>
            </div>
          </div>
        </div>
      )}
      {status === "saved" ? (
        // Dopo "Rimuovi" la conferma del caricamento non vale più.
        hasPhoto && (
          <p role="status" className="text-sm font-medium">
            {t.portraitSaved}
          </p>
        )
      ) : message ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">
          {message}
        </p>
      ) : (
        <FormStatus status={status} />
      )}
    </div>
  );
}

export function BarberPortraitSection({
  barberId,
  name,
  photoUrl,
}: {
  barberId: string;
  name: string;
  photoUrl: string | null;
}) {
  const [removeState, removeAction, removing] = useActionState(removeBarberPhoto, initialRemove);

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <h2 className="font-display text-2xl leading-tight">{t.portraitTitle}</h2>
      <div className="flex items-start gap-4">
        <div className="w-32 shrink-0">
          <BarberPortrait name={name} photoUrl={photoUrl} placeholderClassName="text-4xl" />
        </div>
        <div className="flex flex-col gap-2">
          {photoUrl ? (
            <form
              action={removeAction}
              onSubmit={(event) => {
                if (!window.confirm(t.portraitConfirmRemove)) event.preventDefault();
              }}
            >
              <input type="hidden" name="barberId" value={barberId} />
              <Button type="submit" variant="outline" size="sm" disabled={removing}>
                {t.portraitRemove}
              </Button>
            </form>
          ) : removeState.status === "ok" ? (
            <p role="status" className="text-sm font-medium">
              {t.portraitRemoved}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t.portraitNone}</p>
          )}
          {removeState.status !== "ok" && <FormStatus status={removeState.status} />}
        </div>
      </div>
      <UploadForm barberId={barberId} hasPhoto={photoUrl !== null} />
    </section>
  );
}
