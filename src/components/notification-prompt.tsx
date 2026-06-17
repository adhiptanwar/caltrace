import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  enablePushNotifications,
  getCurrentSubscriptionEndpoint,
  getPushPermission,
  pushSupported,
  isStandalonePWA,
} from "@/lib/push";

const DISMISS_KEY = "trace.notif.prompt.dismissedAt";
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7; // re-ask after 7 days

export function NotificationPrompt() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;

      // iOS requires installing to Home Screen first; don't prompt in Safari.
      const ua = navigator.userAgent;
      const isIOS =
        /iphone|ipad|ipod/i.test(ua) ||
        (/Mac/.test(ua) && "ontouchend" in document);
      if (isIOS && !isStandalonePWA()) return;

      const perm = await getPushPermission();
      if (perm === "denied" || perm === "granted") {
        // If already granted but not subscribed (e.g. cleared data), silently re-subscribe.
        if (perm === "granted") {
          const endpoint = await getCurrentSubscriptionEndpoint();
          if (!endpoint) {
            try {
              await enablePushNotifications();
            } catch {
              // ignore
            }
          }
        }
        return;
      }

      // permission === "default" — check dismissal cooldown
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissedAt && Date.now() - dismissedAt < DISMISS_MS) return;

      // small delay so it doesn't slam the user on first paint
      setTimeout(() => {
        if (!cancelled) setOpen(true);
      }, 1200);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnable = async () => {
    setLoading(true);
    try {
      const result = await enablePushNotifications();
      if (result.ok) {
        toast.success("You'll be reminded at breakfast, lunch & dinner");
        setOpen(false);
      } else {
        toast.error(result.reason || "Couldn't enable notifications");
        // If they actively denied, don't keep asking
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setOpen(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleDismiss())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-foreground/5 grid place-items-center">
            <Bell className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Turn on meal reminders?</DialogTitle>
          <DialogDescription className="text-center">
            Get a gentle nudge at breakfast (8:00 AM), lunch (12:30 PM) and dinner (7:00 PM) — only if you haven't logged yet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-col gap-2 sm:space-x-0">
          <Button onClick={handleEnable} disabled={loading} className="w-full">
            {loading ? "Enabling…" : "Enable reminders"}
          </Button>
          <Button onClick={handleDismiss} variant="ghost" className="w-full">
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
