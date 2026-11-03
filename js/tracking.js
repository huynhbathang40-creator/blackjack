// Recording play + reading stats (Supabase tables: strategies, rounds, round_hands, decisions).
import { supabase } from "./auth.js";

// ---------- Round recording (with an offline-safe queue) ----------
const queueKey = (userId) => `blackjack.pendingRounds.${userId}`;
const listeners = new Set();
let flushing = false;

function readQueue(userId) {
  try {
    return JSON.parse(localStorage.getItem(queueKey(userId)) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(userId, queue) {
  try {
    localStorage.setItem(queueKey(userId), JSON.stringify(queue));
  } catch {
    /* storage full/unavailable — the in-flight round may be lost */
  }
}

function notify(status) {
  listeners.forEach((fn) => fn(status));
}

/** Subscribe to sync status: { state: "saving" | "saved" | "pending" | "error", pending, error? } */
export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount(userId) {
  return readQueue(userId).length;
}

/** Save a finished round. It is queued first, so nothing is lost if the network drops. */
export function recordRound(userId, payload) {
  const queue = readQueue(userId);
  queue.push(payload);
  writeQueue(userId, queue);
  return flushRounds(userId);
}

/** Send every queued round to Supabase, oldest first. */
export async function flushRounds(userId) {
  if (flushing) return;
  flushing = true;
  try {
    let queue = readQueue(userId);
    while (queue.length) {
      notify({ state: "saving", pending: queue.length });
      const { error } = await supabase.rpc("record_round", { payload: queue[0] });
      if (error) {
        notify({ state: "error", pending: queue.length, error });
        return;
      }
      queue = readQueue(userId).filter((p) => p.id !== queue[0].id);
      writeQueue(userId, queue);
    }
    notify({ state: "saved", pending: 0 });
  } catch (error) {
    notify({ state: "error", pending: readQueue(userId).length, error });
  } finally {
    flushing = false;
  }
}

// ---------- Strategies ----------
export async function listStrategies() {
  const { data, error } = await supabase
    .from("strategies")
    .select("id, name, description, created_at")
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function createStrategy(name, description) {
  const { data, error } = await supabase
    .from("strategies")
    .insert({ name: name.trim(), description: description?.trim() || null })
    .select("id, name, description, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("You already have a strategy with that name.");
    throw error;
  }
  return data;
}

export async function deleteStrategy(id) {
  const { error } = await supabase.from("strategies").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Stats ----------
/** filter: "all" | "none" | strategy id */
export async function fetchStats(filter = "all") {
  const { data, error } = await supabase.rpc("get_play_stats", { p_strategy: filter });
  if (error) throw error;
  return data;
}

function applyRoundFilter(query, filter, prefix = "") {
  if (filter === "none") return query.is(prefix + "strategy_id", null);
  if (filter && filter !== "all") return query.eq(prefix + "strategy_id", filter);
  return query;
}

export async function fetchRecentRounds(filter = "all", limit = 20) {
  let query = supabase
    .from("rounds")
    .select("*, strategies(name), round_hands(*), decisions(*)")
    .order("played_at", { ascending: false })
    .limit(limit);
  query = applyRoundFilter(query, filter);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ---------- Export (CSV for modeling) ----------
const PAGE = 1000;

async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const ROUND_FIELDS =
  "played_at, strategy_id, true_count, running_count, cards_remaining, dealer_upcard, dealer_upcard_value, dealer_cards, dealer_total, dealer_blackjack, dealer_bust, strategies(name)";

export async function exportRows(kind, filter = "all") {
  if (kind === "rounds") {
    const rows = await fetchAll(() =>
      applyRoundFilter(supabase.from("rounds").select("*, strategies(name)").order("played_at"), filter),
    );
    return rows.map(({ strategies, user_id, ...r }) => ({ strategy: strategies?.name ?? "", ...r }));
  }

  const table = kind === "hands" ? "round_hands" : "decisions";
  const order = kind === "hands" ? "hand_index" : "seq";
  const rows = await fetchAll(() =>
    applyRoundFilter(
      supabase
        .from(table)
        .select(`*, rounds!inner(${ROUND_FIELDS})`)
        .order("round_id")
        .order(order),
      filter,
      "rounds.",
    ),
  );
  return rows
    .map(({ rounds, user_id, id, ...row }) => {
      const { strategies, strategy_id, ...round } = rounds;
      return { played_at: round.played_at, strategy: strategies?.name ?? "", ...row, ...prefixKeys(round, "round_") };
    })
    .sort((a, b) => a.played_at.localeCompare(b.played_at) || (a.seq ?? a.hand_index) - (b.seq ?? b.hand_index));
}

function prefixKeys(obj, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "played_at") continue;
    out[k.startsWith("dealer_") || k.startsWith(prefix) ? k : prefix + k] = v;
  }
  return out;
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) v = v.join(" ");
    else if (typeof v === "object") v = JSON.stringify(v);
    const s = String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}
