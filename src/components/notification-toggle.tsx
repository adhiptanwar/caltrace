import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  enablePushNotifications,
  disablePushNotifications,
  getCurrentSubscriptionEndpoint,
  getPushPermission,
  pushSupported,
  isStandalonePWA,
} from "@/lib/push";

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) {
        setSupported(false);
        return;
      }
      const p = await getPushPermission();
      const endpoint = await getCurrentSubscriptionEndpoint();
      if (cancelled) return;
      setPermission(p);
      setEnabled(!!endpoint && p === "granted");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (enabled) {
        await disablePushNotifications();
        setEnabled(false);
        toast.success("Meal reminders turned off");
      } else {
        const result = await enablePushNotifications();
        if (result.ok) {
          setEnabled(true);
          setPermission("granted");
          toast.success("You'll be reminded at breakfast, lunch & dinner");
        } else {
          toast.error(result.reason || "Couldn't enable notifications");
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!supported) {
    return (
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        Notifications aren't supported on this browser.
      </div>
    );
  }

  const isIOS =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (/Mac/.test(navigator.userAgent) && "ontouchend" in document));
  const needsInstall = isIOS && !isStandalonePWA();

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {enabled ? (
            <Bell className="h-5 w-5 text-foreground shrink-0" />
          ) : (
            <BellOff className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium">Meal reminders</div>
            <div className="text-[11px] text-muted-foreground">
              8:00 AM · 12:30 PM · 7:00 PM (local time)
            </div>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={loading || needsInstall || permission === "denied"}
          className={`h-9 px-4 rounded-xl text-sm font-medium border transition-colors shrink-0 ${
            enabled
              ? "bg-foreground text-background border-foreground"
              : "bg-card hover:bg-accent"
          } disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : enabled ? (
            "On"
          ) : (
            "Turn on"
          )}
        </button>
      </div>
      {needsInstall && (
        <div className="text-[11px] text-muted-foreground">
          On iPhone, install Trace to your Home Screen first, then open it from the app icon to enable.
        </div>
      )}
      {permission === "denied" && (
        <div className="text-[11px] text-muted-foreground">
          Notifications are blocked. Enable them for Trace in your device settings.
        </div>
      )}
    </div>
  );
}
