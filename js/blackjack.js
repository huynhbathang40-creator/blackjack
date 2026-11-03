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
