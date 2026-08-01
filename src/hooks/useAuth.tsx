import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    // Prevent double-init in StrictMode
    if (initialized.current) return;
    initialized.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Validate against the auth server: remixed projects can hold a token
        // signed by a different project (bad_jwt), which must be discarded.
        const { error } = await supabase.auth.getUser();
        if (error) {
          await supabase.auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }
      }
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = () => supabase.auth.signOut();

  return { user, loading, signOut };
}
