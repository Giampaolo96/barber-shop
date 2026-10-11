"use client";

import { Share } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { it } from "@/i18n/it";

const t = it.pwa.install;
/** "Non ora" vale per sempre su questo dispositivo. */
const DISMISSED_KEY = "pwa-install-dismissed";

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

/** Come si installa qui: istruzioni su iOS, prompt del browser altrove, oppure niente. */
type InstallState =
  | { kind: "unknown" }
  | { kind: "installed" }
  | { kind: "ios" }
  | { kind: "prompt"; event: InstallPromptEvent }
  | { kind: "unsupported" };

type Platform = "unknown" | "installed" | "ios" | "other";

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS si presenta come Mac: lo distingue il touch.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function platformSnapshot(): Platform {
  if (isStandalone()) return "installed";
  return isIos() ? "ios" : "other";
}

const subscribeMedia =
  (media: string) =>
  (onChange: () => void): (() => void) => {
    const query = window.matchMedia(media);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  };

const subscribeDisplayMode = subscribeMedia("(display-mode: standalone)");

/**
 * Telefono: puntatore principale touch e viewport da telefono (anche in orizzontale), non lo user
 * agent. Il PC con Chrome o Edge riceve beforeinstallprompt ma non è un telefono.
 */
const PHONE_QUERY = "(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)";
const subscribePhone = subscribeMedia(PHONE_QUERY);
const phoneSnapshot = (): boolean => window.matchMedia(PHONE_QUERY).matches;

// Sul server (e prima dell'idratazione) non si sa nulla: niente banner.
const unknownPlatform = (): Platform => "unknown";
const notPhoneOnServer = (): boolean => false;

/** true sui telefoni (vedi PHONE_QUERY); false sul server e prima dell'idratazione. */
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, phoneSnapshot, notPhoneOnServer);
}

function useInstallState(): { state: InstallState; install: () => void } {
  const platform = useSyncExternalStore(subscribeDisplayMode, platformSnapshot, unknownPlatform);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Il browser propone l'installazione quando vuole: si tiene l'evento per il pulsante.
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const state: InstallState =
    platform === "unknown"
      ? { kind: "unknown" }
      : installed || platform === "installed"
        ? { kind: "installed" }
        : platform === "ios"
          ? { kind: "ios" }
          : promptEvent
            ? { kind: "prompt", event: promptEvent }
            : { kind: "unsupported" };

  // Il prompt del browser si può aprire una volta sola: dopo resta solo l'eventuale nuovo evento.
  const install = () => {
    if (!promptEvent) return;
    setPromptEvent(null);
    void promptEvent.prompt();
  };

  return { state, install };
}

// "Non ora": salvato sul dispositivo; se lo storage non c'è, vale fino al ricaricamento.
let dismissedNow = false;
const dismissListeners = new Set<() => void>();

function readDismissed(): boolean {
  if (dismissedNow) return true;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDismissed(): void {
  dismissedNow = true;
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage non disponibile (es. navigazione privata): resta il valore in memoria.
  }
  dismissListeners.forEach((listener) => listener());
}

function subscribeDismissed(onChange: () => void): () => void {
  dismissListeners.add(onChange);
  return () => dismissListeners.delete(onChange);
}

const dismissedOnServer = (): boolean => true;

function IosInstructions() {
  return (
    <p className="flex items-start gap-2 text-sm">
      <Share aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{t.iosInstructions}</span>
    </p>
  );
}

/**
 * Banner in home (SPEC §5.6): solo sui telefoni e dove si può installare, mai nell'app già
 * installata né sul computer.
 */
export function InstallBanner() {
  const { state, install } = useInstallState();
  const isPhone = useIsPhone();
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, dismissedOnServer);

  if (!isPhone || dismissed || (state.kind !== "ios" && state.kind !== "prompt")) return null;

  return (
    <section aria-label={t.title} className="flex flex-col gap-3 border border-ink p-4">
      <h2 className="font-display text-xl">{t.title}</h2>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      {state.kind === "ios" && <IosInstructions />}
      <div className="flex gap-2">
        {state.kind === "prompt" && <Button onClick={install}>{t.install}</Button>}
        <Button variant="ghost" onClick={saveDismissed}>
          {t.dismiss}
        </Button>
      </div>
    </section>
  );
}

/**
 * Voce fissa nel profilo su ogni dispositivo, anche dopo "Non ora"; nascosta nell'app già
 * installata. Sul computer i testi non parlano di telefono né di schermata Home.
 */
export function InstallAppEntry() {
  const { state, install } = useInstallState();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);

  if (state.kind === "unknown" || state.kind === "installed") return null;
  const desktop = !isPhone && state.kind !== "ios";
  const label = desktop ? t.profileEntryDesktop : t.profileEntry;

  if (state.kind === "prompt") {
    return (
      <Button variant="outline" className="w-fit" onClick={install}>
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" className="w-fit" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open &&
        (state.kind === "ios" ? (
          <IosInstructions />
        ) : (
          <p className="text-sm">{desktop ? t.desktopInstructions : t.otherInstructions}</p>
        ))}
    </div>
  );
}
