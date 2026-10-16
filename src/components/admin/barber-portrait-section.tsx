"use client";

import { startTransition, useActionState, useState } from "react";
import { BarberPortrait } from "@/components/barber-portrait";
import { FormStatus } from "@/components/admin/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { it } from "@/i18n/it";
import { removeBarberPhoto, uploadBarberPhoto } from "@/lib/admin/barber-photo-actions";
import type { BarberPhotoRemoveState, BarberPhotoState } from "@/lib/admin/barber-photo-actions";
import { PORTRAIT_SIZE, encodePortrait } from "@/lib/barbers/portrait-encoding";

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

function UploadForm({ barberId, hasPhoto }: { barberId: string; hasPhoto: boolean }) {
  const [state, formAction, pending] = useActionState(uploadBarberPhoto, initialUpload);
  const [localFailure, setLocalFailure] = useState<"not_image" | "encode_failed" | null>(null);
  const [resizing, setResizing] = useState(false);
  const busy = pending || resizing;
  const status = localFailure ?? state.status;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("photo");
    if (!(file instanceof File) || file.size === 0) return;

    setResizing(true);
    let result: ResizeResult;
    try {
      result = await resizePortrait(file);
    } finally {
      setResizing(false);
    }
    // Il browser non ha potuto preparare il file: non si invia nulla.
    if ("failure" in result) {
      setLocalFailure(result.failure);
      return;
    }
    setLocalFailure(null);

    const { blob } = result;
    const data = new FormData();
    data.set("barberId", barberId);
    data.set("photo", new File([blob], `ritratto.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type }));
    startTransition(() => formAction(data));
  }

  const message = uploadMessages[status];
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <Label htmlFor="photo">{t.portraitLabel}</Label>
      <Input id="photo" name="photo" type="file" accept="image/*" required />
      <p className="text-sm text-muted-foreground">{t.portraitHint}</p>
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? t.portraitWorking : t.portraitUpload}
      </Button>
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
    </form>
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
