import { useEffect, useRef } from "react";
import { toast } from "sonner";

declare const __APP_BUILD_ID__: string;

const POLL_INTERVAL_MS = 30_000;
const CURRENT_BUILD_ID = __APP_BUILD_ID__;

export function VersionChecker() {
  const updateAvailableRef = useRef(false);
  const toastShownRef = useRef(false);
  const notificationShownRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    const reload = () => window.location.reload();

    function showUpdateToast() {
      if (toastShownRef.current) return;
      toastShownRef.current = true;
      toast("New version available", {
        description: "Reload to get the latest updates.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: reload,
        },
      });
    }

    async function showBackgroundNotification() {
      if (notificationShownRef.current) return false;
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      if (!("serviceWorker" in navigator)) return false;

      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("New version available", {
          body: "Tap to refresh Trace.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: `trace-update-${CURRENT_BUILD_ID}`,
          data: { url: "/app", reload: true, version: CURRENT_BUILD_ID },
        });
        notificationShownRef.current = true;
        return true;
      } catch {
        return false;
      }
    }

    async function handleUpdateAvailable() {
      updateAvailableRef.current = true;
      if (document.visibilityState === "visible") {
        showUpdateToast();
        return;
      }
      await showBackgroundNotification();
    }

    async function check() {
      if (updateAvailableRef.current || cancelled) return;
      try {
        void navigator.serviceWorker?.getRegistration("/").then((reg) => reg?.update()).catch(() => undefined);
        const res = await fetch("/api/public/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!data.buildId || data.buildId === CURRENT_BUILD_ID) return;
        await handleUpdateAvailable();
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
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);
    document.addEventListener("resume", check);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
      document.removeEventListener("resume", check);
    };
  }, []);

  return null;
}
