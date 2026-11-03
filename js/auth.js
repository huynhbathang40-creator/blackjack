// Google sign-in via Supabase Auth.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm";

// Publishable (client-side) credentials — safe to ship in browser code.
const SUPABASE_URL = "https://xvyfefwjkabjzdqartrt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-CBxXLP4piKrn0wuPOaVDA_OBhx4Y-X";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Redirects the browser to Google; Supabase brings the user back to this page. */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Calls `callback(user | null)` now and whenever the signed-in user changes. */
export function onUserChange(callback) {
  let lastId = Symbol("unset"); // so the first event (even "signed out") always notifies
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    const id = user?.id ?? null;
    // Token refreshes fire too; only notify when the user actually changes.
    if (id === lastId) return;
    lastId = id;
    // Defer so the callback can safely call other Supabase methods.
    setTimeout(() => callback(user), 0);
  });
}

/** Error returned by the OAuth redirect (e.g. user cancelled), if any. */
export function oauthErrorFromUrl() {
  const params = new URLSearchParams(window.location.search + "&" + window.location.hash.slice(1));
  return params.get("error_description") || params.get("error");
}

/** Remove ?code= / #access_token= / error params left by the OAuth redirect. */
export function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const keys = ["code", "error", "error_code", "error_description", "state"];
  const hadParams = keys.some((k) => url.searchParams.has(k)) || url.hash.includes("access_token") || url.hash.includes("error");
  if (!hadParams) return;
  keys.forEach((k) => url.searchParams.delete(k));
  url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search);
}

/** Display-friendly profile details from a Supabase user signed in with Google. */
export function profileOf(user) {
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || user.email?.split("@")[0] || "Player";
  return {
    id: user.id,
    name,
    firstName: meta.given_name || name.split(" ")[0],
    email: user.email || "",
    avatar: meta.avatar_url || meta.picture || "",
  };
}
