import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/app" : "/auth" });
  },
  component: () => null,
});
