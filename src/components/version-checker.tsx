import { useEffect, useRef } from "react";
import { toast } from "sonner";

declare const __APP_BUILD_ID__: string;

const POLL_INTERVAL_MS = 60_000; // 1 minute
const CURRENT_BUILD_ID = __APP_BUILD_ID__;

export function VersionChecker() {
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    async function check() {
      if (notifiedRef.current || cancelled) return;
      try {
        const res = await fetch("/api/public/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!data.buildId || data.buildId === CURRENT_BUILD_ID) return;

        notifiedRef.current = true;
        toast("New version available", {
          description: "Reload to get the latest updates.",
          duration: Infinity,
          action: {
            label: "Reload",
            onClick: () => window.location.reload(),
          },
        });
      } catch {
        // network issue — try again next tick
      }
    }

    // Initial check after a short delay so first paint isn't blocked
    const initialTimer = window.setTimeout(check, 5_000);
    const interval = window.setInterval(check, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);

  return null;
}
