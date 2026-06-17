import { useEffect, useRef } from "react";
import { toast } from "sonner";

declare const __APP_BUILD_ID__: string;

const POLL_INTERVAL_MS = 30_000;
const CURRENT_BUILD_ID = __APP_BUILD_ID__;
const LAST_SEEN_BUILD_KEY = "trace.lastSeenBuildId";

function canUseServiceWorkerHere() {
  if (!("serviceWorker" in navigator)) return false;
  const host = window.location.hostname;
  if (window.self !== window.top) return false;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return false;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) {
    return false;
  }
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) {
    return false;
  }
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return false;
  return true;
}

export function VersionChecker() {
  const updateAvailableRef = useRef(false);
  const toastShownRef = useRef(false);
  const notificationShownRef = useRef(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    try {
      const lastSeenBuildId = window.localStorage.getItem(LAST_SEEN_BUILD_KEY);
      if (lastSeenBuildId && lastSeenBuildId !== CURRENT_BUILD_ID) {
        toast.success("Trace updated", {
          description: "You're now using the latest version.",
        });
      }
      window.localStorage.setItem(LAST_SEEN_BUILD_KEY, CURRENT_BUILD_ID);
    } catch {
      // Storage may be unavailable in private browsing.
    }

    async function applyUpdate() {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      try {
        if (canUseServiceWorkerHere()) {
          const reg = await navigator.serviceWorker.getRegistration("/");
          if (reg?.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
            // controllerchange handler will reload
            return;
          }
        }
      } catch {
        // fall through to hard reload
      }
      window.location.replace(`/app?updated=${Date.now()}`);
    }

    function showUpdateToast() {
      if (toastShownRef.current) return;
      toastShownRef.current = true;
      toast("New version available", {
        description: "Update Trace to get the latest changes.",
        duration: Infinity,
        action: {
          label: "Update now",
          onClick: () => {
            void applyUpdate();
          },
        },
      });
    }

    async function showBackgroundNotification(nextBuildId: string) {
      if (notificationShownRef.current) return false;
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      if (!canUseServiceWorkerHere()) return false;

      try {
        const reg = await navigator.serviceWorker.register(
          `/sw.js?v=${CURRENT_BUILD_ID}`,
          { scope: "/" },
        );
        await reg.showNotification("New version available", {
          body: "Tap to update Trace.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `trace-update-${nextBuildId}`,
          data: { url: "/app", reload: true, version: nextBuildId },
        });
        notificationShownRef.current = true;
        return true;
      } catch {
        return false;
      }
    }

    // ===== Service worker update lifecycle (canonical pattern) =====
    if (canUseServiceWorkerHere()) {
      // Reload exactly once when the new SW takes control.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingRef.current) {
          window.location.replace(`/app?updated=${Date.now()}`);
        }
      });

      // Register with a versioned URL so each deploy is a byte-different SW
      // → triggers updatefound automatically.
      navigator.serviceWorker
        .register(`/sw.js?v=${CURRENT_BUILD_ID}`, { scope: "/" })
        .then((reg) => {
          // If a new SW is already waiting from a previous tab, prompt now.
          if (reg.waiting && navigator.serviceWorker.controller) {
            void handleUpdateAvailable(CURRENT_BUILD_ID);
          }
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                void handleUpdateAvailable(CURRENT_BUILD_ID);
              }
            });
          });
        })
        .catch(() => undefined);
    }

    async function handleUpdateAvailable(nextBuildId: string) {
      updateAvailableRef.current = true;
      try {
        window.localStorage.setItem("trace.pendingBuildId", nextBuildId);
      } catch {
        // ignore
      }
      if (document.visibilityState === "visible") {
        showUpdateToast();
        return;
      }
      await showBackgroundNotification(nextBuildId);
    }

    async function check() {
      if (updateAvailableRef.current || cancelled) return;
      try {
        if (canUseServiceWorkerHere()) {
          void navigator.serviceWorker
            .getRegistration("/")
            .then((reg) => reg?.update())
            .catch(() => undefined);
        }
        const res = await fetch(`/api/public/version?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!data.buildId || data.buildId === CURRENT_BUILD_ID) return;
        await handleUpdateAvailable(data.buildId);
      } catch {
        // network issue — try again next tick
      }
    }

    // Initial check after a short delay so first paint isn't blocked
    const initialTimer = window.setTimeout(check, 5_000);
    const interval = window.setInterval(check, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (updateAvailableRef.current) showUpdateToast();
      else check();
    };
    const onWake = () => {
      if (updateAvailableRef.current) showUpdateToast();
      else check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("resume", onWake);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("resume", onWake);
    };
  }, []);

  return null;
}
