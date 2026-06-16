import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Wait briefly for Supabase to hydrate session (e.g. just after OAuth redirect)
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      session = await new Promise((resolve) => {
        const sub = supabase.auth.onAuthStateChange((_e, s) => {
          if (s) { clearTimeout(timer); sub.data.subscription.unsubscribe(); resolve(s); }
        });
        const timer = setTimeout(() => { sub.data.subscription.unsubscribe(); resolve(null); }, 1500);
      });
    }
    if (!session) throw redirect({ to: "/auth" });
    return { user: session.user };
  },
  component: () => <Outlet />,
});
