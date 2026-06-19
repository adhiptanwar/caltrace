import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

// Inline script: runs before the JS bundle finishes downloading.
// Reads the cached Supabase session from localStorage and redirects
// immediately, so slow connections (e.g. India) don't time out
// waiting for the full app bundle before the auth check + redirect.
const instantRedirectScript = `(function(){try{
  var hasSession=false;
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')!==-1){
      var v=localStorage.getItem(k);
      if(v&&v.indexOf('access_token')!==-1){hasSession=true;break;}
    }
  }
  location.replace(hasSession?'/app':'/auth');
}catch(e){location.replace('/auth');}})();`;

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    throw redirect({ to: data.user ? "/app" : "/auth" });
  },
  component: IndexRedirect,
});

function IndexRedirect() {
  useEffect(() => {
    // Fallback if the inline script didn't fire for some reason.
    const t = setTimeout(() => {
      window.location.replace("/auth");
    }, 100);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: instantRedirectScript }} />
    </>
  );
}
