import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handScore, isBlackjack, canSplit, dealerShouldHit, settleHand,
} from "../js/blackjack.js";

const c = (value) => ({ value, code: value[0] + "S", suit: "SPADES" });
const hand = (vals, bet = 10, fromSplit = false) => ({ cards: vals.map(c), bet, fromSplit });

test("scores hands with soft and hard aces", () => {
  assert.deepEqual(handScore([c("ACE"), c("6")]), { total: 17, soft: true });
  assert.deepEqual(handScore([c("ACE"), c("6"), c("KING")]), { total: 17, soft: false });
  assert.deepEqual(handScore([c("ACE"), c("ACE"), c("9")]), { total: 21, soft: true });
  assert.equal(handScore([c("KING"), c("QUEEN"), c("5")]).total, 25);
});

test("detects blackjack only on two cards", () => {
  assert.ok(isBlackjack([c("ACE"), c("JACK")]));
  assert.ok(!isBlackjack([c("7"), c("7"), c("7")]));
});

test("split allowed for equal-value pairs", () => {
  assert.ok(canSplit([c("KING"), c("10")]));
  assert.ok(canSplit([c("8"), c("8")]));
  assert.ok(!canSplit([c("8"), c("9")]));
});

test("dealer stands on all 17s", () => {
  assert.ok(dealerShouldHit([c("10"), c("6")]));
  assert.ok(!dealerShouldHit([c("ACE"), c("6")]));
  assert.ok(!dealerShouldHit([c("10"), c("7")]));
});

test("settles outcomes and payouts", () => {
  const dealer18 = [c("10"), c("8")].map((x) => x);
  assert.deepEqual(settleHand(hand(["ACE", "KING"]), dealer18), { outcome: "blackjack", payout: 25 });
  assert.deepEqual(settleHand(hand(["10", "9"]), dealer18), { outcome: "win", payout: 20 });
  assert.deepEqual(settleHand(hand(["10", "8"]), dealer18), { outcome: "push", payout: 10 });
  assert.deepEqual(settleHand(hand(["10", "7"]), dealer18), { outcome: "lose", payout: 0 });
  assert.deepEqual(settleHand(hand(["10", "6", "9"]), [c("10"), c("6"), c("9")]), { outcome: "bust", payout: 0 });
  assert.deepEqual(settleHand(hand(["10", "6"]), [c("10"), c("6"), c("9")]), { outcome: "win", payout: 20 });
  assert.deepEqual(settleHand(hand(["ACE", "KING"]), [c("ACE"), c("QUEEN")]), { outcome: "push", payout: 10 });
  assert.deepEqual(settleHand(hand(["10", "10", "ACE"]), [c("ACE"), c("QUEEN")]), { outcome: "lose", payout: 0 });
  // 21 after a split is not a natural
  assert.deepEqual(settleHand(hand(["ACE", "KING"], 10, true), dealer18), { outcome: "win", payout: 20 });
});
