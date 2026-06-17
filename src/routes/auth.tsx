import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import logoBlack from "@/assets/trace-mark-black.png.asset.json";
import logoWhite from "@/assets/trace-mark-white.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — Trace" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let done = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!done && data.session) {
        done = true;
        navigate({ to: "/app", replace: true });
      }
    });
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) {
        done = true;
        navigate({ to: "/app", replace: true });
      }
    });
    return () => sub.data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) {
          const msg = error.message?.toLowerCase() ?? "";
          if (msg.includes("registered") || msg.includes("exists")) {
            toast.error("An account with this email already exists. Please sign in.");
            setMode("signin");
          } else {
            toast.error(error.message);
          }
          return;
        }
        // Supabase returns a user with empty identities[] when email already exists
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          toast.error("An account with this email already exists. Please sign in.");
          setMode("signin");
          return;
        }
        if (data.session) {
          toast.success("Welcome to Trace");
          navigate({ to: "/app", replace: true });
        } else {
          toast.success("Check your email to confirm your account");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = error.message?.toLowerCase() ?? "";
          if (msg.includes("invalid") || msg.includes("credentials")) {
            toast.error("No account found, or wrong password. Please sign up first.");
          } else {
            toast.error(error.message);
          }
          return;
        }
        if (data.session) navigate({ to: "/app", replace: true });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) {
      toast.error(res.error.message ?? "Google sign-in failed");
      setBusy(false);
      return;
    }
    if (res.redirected) return;
    navigate({ to: "/app" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-3">
            <img src={logoBlack.url} alt="" className="h-9 w-9 dark:hidden" />
            <img src={logoWhite.url} alt="" className="h-9 w-9 hidden dark:block" />
            <h1 className="text-3xl font-semibold tracking-tight">Trace</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Food & weight, quietly tracked.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
          Continue with Google
        </Button>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-6 block w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {mode === "signin" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
