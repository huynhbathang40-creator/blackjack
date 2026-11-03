// Pure Blackjack rules — no DOM, no network. Easy to test.

export const DEALER_HITS_SOFT_17 = false; // Dealer stands on all 17s
export const BLACKJACK_PAYOUT = 1.5; // 3:2

/** Point value of a card from the Deck of Cards API ("ACE", "KING", "10", ...). */
export function cardValue(card) {
  switch (card.value) {
    case "ACE":
      return 11;
    case "KING":
    case "QUEEN":
    case "JACK":
      return 10;
    default:
      return Number(card.value);
  }
}

/** Returns { total, soft } — soft means an ace is still being counted as 11. */
export function handScore(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.value === "ACE") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handScore(cards).total === 21;
}

export function isBust(cards) {
  return handScore(cards).total > 21;
}

export function canSplit(cards) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

export function dealerShouldHit(cards) {
  const { total, soft } = handScore(cards);
  if (total < 17) return true;
  if (total === 17 && soft && DEALER_HITS_SOFT_17) return true;
  return false;
}

/**
 * Settle one player hand against the dealer.
 * @param {object} hand { cards, bet, fromSplit }
 * @returns {{ outcome: string, payout: number }} payout is the total returned to
 *          the player (stake included); 0 means the bet was lost.
 */
export function settleHand(hand, dealerCards) {
  const player = handScore(hand.cards).total;
  const dealer = handScore(dealerCards).total;
  // A 21 on a split hand is not a natural blackjack.
  const playerBJ = !hand.fromSplit && isBlackjack(hand.cards);
  const dealerBJ = isBlackjack(dealerCards);

  if (player > 21) return { outcome: "bust", payout: 0 };
  if (playerBJ && dealerBJ) return { outcome: "push", payout: hand.bet };
  if (playerBJ) return { outcome: "blackjack", payout: hand.bet * (1 + BLACKJACK_PAYOUT) };
  if (dealerBJ) return { outcome: "lose", payout: 0 };
  if (dealer > 21) return { outcome: "win", payout: hand.bet * 2 };
  if (player > dealer) return { outcome: "win", payout: hand.bet * 2 };
  if (player < dealer) return { outcome: "lose", payout: 0 };
  return { outcome: "push", payout: hand.bet };
}

// ---------- Analysis helpers (used for recording play) ----------

/** Equal-value pair (K+Q counts as a pair of 10s, matching our split rule). */
export function isPair(cards) {
  return canSplit(cards);
}

/** Human-readable spot, e.g. "Hard 16", "Soft 18", "Pair 8s", "Pair As", "Blackjack". */
export function situationOf(cards, { fromSplit = false } = {}) {
  if (!fromSplit && isBlackjack(cards)) return "Blackjack";
  if (isPair(cards)) {
    const v = cardValue(cards[0]);
    return v === 11 ? "Pair As" : `Pair ${v}s`;
  }
  const { total, soft } = handScore(cards);
  return `${soft ? "Soft" : "Hard"} ${total}`;
}

/** Hi-Lo card counting value: 2–6 = +1, 7–9 = 0, 10/face/ace = −1. */
export function hiLoValue(card) {
  const v = cardValue(card);
  if (v <= 6) return 1;
  if (v >= 10) return -1;
  return 0;
}

/**
 * Basic strategy for these table rules: 6 decks, dealer stands on soft 17,
 * double after split allowed, double on any first two cards, no surrender.
 * @param cards   the player's hand
 * @param upcard  the dealer's face-up card
 * @param options canDouble / canSplit — whether those moves are available right now
 * @returns "hit" | "stand" | "double" | "split"
 */
export function basicStrategy(cards, upcard, { canDouble = true, canSplit: splitOk = true } = {}) {
  const up = cardValue(upcard); // 2..11 (ace = 11)
  canDouble = canDouble && cards.length === 2; // doubling needs exactly two cards
  const between = (lo, hi) => up >= lo && up <= hi;
  const double = () => (canDouble ? "double" : "hit"); // "Dh"
  const doubleOrStand = () => (canDouble ? "double" : "stand"); // "Ds"

  if (splitOk && isPair(cards)) {
    const v = cardValue(cards[0]);
    if (v === 11 || v === 8) return "split";
    if (v === 9 && (between(2, 6) || up === 8 || up === 9)) return "split";
    if ((v === 7 || v === 2 || v === 3) && between(2, 7)) return "split";
    if (v === 6 && between(2, 6)) return "split";
    if (v === 4 && between(5, 6)) return "split";
    // 10s, 5s and the remaining pair spots are played as totals below
  }

  const { total, soft } = handScore(cards);

  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) {
      if (between(3, 6)) return doubleOrStand();
      if (up === 2 || up === 7 || up === 8) return "stand";
      return "hit";
    }
    if (total === 17) return between(3, 6) ? double() : "hit";
    if (total === 15 || total === 16) return between(4, 6) ? double() : "hit";
    if (total === 13 || total === 14) return between(5, 6) ? double() : "hit";
    return "hit"; // soft 12 (A,A when it can't be split)
  }

  if (total >= 17) return "stand";
  if (total >= 13) return up <= 6 ? "stand" : "hit";
  if (total === 12) return between(4, 6) ? "stand" : "hit";
  if (total === 11) return up <= 10 ? double() : "hit";
  if (total === 10) return up <= 9 ? double() : "hit";
  if (total === 9) return between(3, 6) ? double() : "hit";
  return "hit";
}
