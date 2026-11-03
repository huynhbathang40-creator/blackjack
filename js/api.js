// Thin wrapper around https://deckofcardsapi.com/

const BASE = "https://deckofcardsapi.com/api/deck";
export const CARD_BACK = "https://deckofcardsapi.com/static/img/back.png";

async function request(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Deck API error (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Deck API request failed");
  return data;
}

/** Create a new shuffled shoe. Returns { deck_id, remaining }. */
export function newShoe(deckCount = 6) {
  return request(`new/shuffle/?deck_count=${deckCount}`);
}

/** Draw `count` cards. Returns { cards, remaining }. */
export function draw(deckId, count = 1) {
  return request(`${deckId}/draw/?count=${count}`);
}

/** Return every drawn card to the shoe and reshuffle. */
export function reshuffle(deckId) {
  return request(`${deckId}/shuffle/`);
}
