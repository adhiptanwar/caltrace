import { useEffect } from "react";
import { toast } from "sonner";

declare const __APP_BUILD_ID__: string;

const CURRENT_BUILD_ID = __APP_BUILD_ID__;
const LAST_SEEN_BUILD_KEY = "trace.lastSeenBuildId";

export function VersionChecker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!import.meta.env.PROD) return;

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
  }, []);

  return null;
}
