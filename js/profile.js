// Player profiles stored in Supabase (table: public.profiles).
import { supabase } from "./auth.js";

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const BIO_MAX = 280;

// ---------- Data ----------
export async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data; // null when the player hasn't created one yet
}

export async function saveProfile(userId, fields) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function isUsernameTaken(username, userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", userId)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

/** Turn a name or email into a valid username suggestion. */
export function suggestUsername(googleProfile) {
  const base = (googleProfile.email.split("@")[0] || googleProfile.name || "player")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return base.length >= 3 ? base : (base + "_player").slice(0, 20);
}

function friendlyError(err) {
  if (err?.code === "23505") return "That username is already taken. Try another one.";
  if (err?.code === "23514") return "Some details aren't valid. Check the fields and try again.";
  return err?.message || "Something went wrong. Please try again.";
}

// ---------- Page ----------
const $ = (id) => document.getElementById(id);

/**
 * Wires up the Profile tab.
 * @param {{ onChange: (profile) => void, onDone: () => void }} hooks
 *   onChange — called whenever the saved profile loads or changes
 *   onDone   — called when the player chooses "Skip for now" / finishes creating
 */
export function setupProfilePage({ onChange, onDone }) {
  const el = {
    loading: $("profile-loading"),
    view: $("profile-view"),
    form: $("profile-form"),
    // view
    vAvatar: $("pv-avatar"),
    vInitials: $("pv-initials"),
    vName: $("pv-name"),
    vUsername: $("pv-username"),
    vLocation: $("pv-location"),
    vBio: $("pv-bio"),
    vSince: $("pv-since"),
    edit: $("btn-edit-profile"),
    // form
    title: $("pf-title"),
    intro: $("pf-intro"),
    avatarPreview: $("pf-avatar-preview"),
    avatar: $("pf-avatar"),
    useGoogle: $("pf-use-google"),
    username: $("pf-username"),
    usernameHint: $("pf-username-hint"),
    display: $("pf-display"),
    location: $("pf-location"),
    bio: $("pf-bio"),
    bioCount: $("pf-bio-count"),
    status: $("pf-status"),
    cancel: $("pf-cancel"),
    save: $("pf-save"),
  };

  let user = null; // { id, name, email, avatar } from Google
  let profile = null; // saved row, or null
  let usernameCheck = 0;

  function setStatus(text, tone = "") {
    el.status.textContent = text;
    el.status.className = "form-status" + (tone ? " " + tone : "");
  }

  function setAvatar(img, fallback, url, name) {
    fallback.textContent = initials(name);
    fallback.hidden = false;
    img.hidden = true;
    img.onload = () => {
      img.hidden = false;
      fallback.hidden = true;
    };
    img.onerror = () => {
      img.hidden = true;
      fallback.hidden = false;
    };
    if (url) img.src = url;
    else img.removeAttribute("src");
  }

  function showView() {
    el.loading.hidden = true;
    el.form.hidden = true;
    el.view.hidden = false;
    setAvatar(el.vAvatar, el.vInitials, profile.avatar_url, profile.display_name);
    el.vAvatar.alt = profile.display_name;
    el.vName.textContent = profile.display_name;
    el.vUsername.textContent = "@" + profile.username;
    el.vLocation.textContent = profile.location ? "📍 " + profile.location : "";
    el.vLocation.hidden = !profile.location;
    el.vBio.textContent = profile.bio || "No bio yet.";
    el.vBio.classList.toggle("empty", !profile.bio);
    el.vSince.textContent =
      "Member since " + new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function showForm() {
    const creating = !profile;
    el.loading.hidden = true;
    el.view.hidden = true;
    el.form.hidden = false;
    el.title.textContent = creating ? "Create your player profile" : "Edit your profile";
    el.intro.hidden = !creating;
    el.save.textContent = creating ? "Create profile" : "Save changes";
    el.cancel.textContent = creating ? "Skip for now" : "Cancel";

    el.username.value = profile?.username ?? suggestUsername(user);
    el.display.value = profile?.display_name ?? user.name;
    el.location.value = profile?.location ?? "";
    el.bio.value = profile?.bio ?? "";
    el.avatar.value = profile ? profile.avatar_url ?? "" : user.avatar;
    el.useGoogle.hidden = !user.avatar;
    updateBioCount();
    updatePreview();
    setStatus("");
    validateUsername();
  }

  function updateBioCount() {
    el.bioCount.textContent = el.bio.value.length;
  }

  function updatePreview() {
    const url = el.avatar.value.trim();
    const fallback = el.avatarPreview.nextElementSibling;
    setAvatar(el.avatarPreview, fallback, /^https:\/\//.test(url) ? url : "", el.display.value || user.name);
  }

  function usernameProblem(value) {
    if (!value) return "Pick a username.";
    if (value.length < 3) return "Usernames need at least 3 characters.";
    if (!USERNAME_RE.test(value)) return "Use only lowercase letters, numbers and underscores.";
    return "";
  }

  async function validateUsername() {
    const value = el.username.value;
    const problem = usernameProblem(value);
    const ticket = ++usernameCheck;
    if (problem) {
      el.usernameHint.textContent = problem;
      el.usernameHint.className = "field-hint error";
      return false;
    }
    if (profile && value === profile.username) {
      el.usernameHint.textContent = "This is your current username.";
      el.usernameHint.className = "field-hint";
      return true;
    }
    el.usernameHint.textContent = "Checking availability…";
    el.usernameHint.className = "field-hint";
    try {
      const taken = await isUsernameTaken(value, user.id);
      if (ticket !== usernameCheck) return !taken; // a newer check is running
      el.usernameHint.textContent = taken ? `@${value} is taken.` : `@${value} is available!`;
      el.usernameHint.className = "field-hint " + (taken ? "error" : "ok");
      return !taken;
    } catch {
      el.usernameHint.textContent = "3–20 characters: lowercase letters, numbers, underscores.";
      el.usernameHint.className = "field-hint";
      return true; // the save itself will catch duplicates
    }
  }

  let debounce;
  el.username.addEventListener("input", () => {
    const cleaned = el.username.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (cleaned !== el.username.value) el.username.value = cleaned;
    clearTimeout(debounce);
    debounce = setTimeout(validateUsername, 350);
  });
  el.bio.addEventListener("input", updateBioCount);
  el.avatar.addEventListener("input", updatePreview);
  el.display.addEventListener("input", updatePreview);
  el.useGoogle.addEventListener("click", () => {
    el.avatar.value = user.avatar;
    updatePreview();
  });
  el.edit.addEventListener("click", showForm);
  el.cancel.addEventListener("click", () => {
    if (profile) showView();
    else onDone();
  });

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const display = el.display.value.trim();
    const avatar = el.avatar.value.trim();
    if (!display) return setStatus("Enter a display name.", "error"), el.display.focus();
    if (avatar && !/^https:\/\//.test(avatar)) {
      return setStatus("Photo URL must start with https://", "error"), el.avatar.focus();
    }
    clearTimeout(debounce);
    if (!(await validateUsername())) return setStatus("Fix your username first.", "error"), el.username.focus();

    const creating = !profile;
    el.save.disabled = true;
    setStatus(creating ? "Creating your profile…" : "Saving…");
    try {
      profile = await saveProfile(user.id, {
        username: el.username.value,
        display_name: display,
        location: el.location.value.trim() || null,
        bio: el.bio.value.trim() || null,
        avatar_url: avatar || null,
      });
      onChange(profile);
      showView();
      if (creating) setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), "error");
    } finally {
      el.save.disabled = false;
    }
  });

  return {
    /** Load the signed-in player's profile. Resolves to the profile or null. */
    async load(googleUser) {
      user = googleUser;
      profile = null;
      el.view.hidden = true;
      el.form.hidden = true;
      el.loading.hidden = false;
      el.loading.textContent = "Loading your profile…";
      try {
        profile = await fetchProfile(user.id);
      } catch (err) {
        console.error(err);
        el.loading.textContent = "Couldn't load your profile. Refresh to try again.";
        return undefined;
      }
      if (profile) showView();
      else showForm();
      onChange(profile);
      return profile;
    },
  };
}

function initials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
