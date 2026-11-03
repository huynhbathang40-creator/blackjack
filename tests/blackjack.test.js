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

import { basicStrategy, situationOf, hiLoValue } from "../js/blackjack.js";

const cards = (...vals) => vals.map(c);
const up = (v) => c(v);

test("basic strategy: hard totals", () => {
  assert.equal(basicStrategy(cards("10", "6"), up("10")), "hit");
  assert.equal(basicStrategy(cards("10", "6"), up("6")), "stand");
  assert.equal(basicStrategy(cards("10", "2"), up("3")), "hit");
  assert.equal(basicStrategy(cards("10", "2"), up("4")), "stand");
  assert.equal(basicStrategy(cards("6", "5"), up("10")), "double");
  assert.equal(basicStrategy(cards("6", "5"), up("ACE")), "hit");
  assert.equal(basicStrategy(cards("6", "4"), up("10")), "hit");
  assert.equal(basicStrategy(cards("5", "4"), up("2")), "hit");
  assert.equal(basicStrategy(cards("5", "4"), up("3")), "double");
  assert.equal(basicStrategy(cards("10", "7"), up("ACE")), "stand");
  // can't double with three cards -> hit
  assert.equal(basicStrategy(cards("2", "3", "6"), up("5")), "hit");
});

test("basic strategy: soft totals", () => {
  assert.equal(basicStrategy(cards("ACE", "7"), up("2")), "stand");
  assert.equal(basicStrategy(cards("ACE", "7"), up("5")), "double");
  assert.equal(basicStrategy(cards("ACE", "7"), up("9")), "hit");
  assert.equal(basicStrategy(cards("ACE", "2", "5"), up("5")), "stand"); // soft 18, no double -> stand
  assert.equal(basicStrategy(cards("ACE", "6"), up("2")), "hit");
  assert.equal(basicStrategy(cards("ACE", "6"), up("3")), "double");
  assert.equal(basicStrategy(cards("ACE", "2"), up("5")), "double");
  assert.equal(basicStrategy(cards("ACE", "2"), up("4")), "hit");
  assert.equal(basicStrategy(cards("ACE", "8"), up("6")), "stand");
});

test("basic strategy: pairs", () => {
  assert.equal(basicStrategy(cards("ACE", "ACE"), up("10")), "split");
  assert.equal(basicStrategy(cards("8", "8"), up("ACE")), "split");
  assert.equal(basicStrategy(cards("KING", "QUEEN"), up("6")), "stand");
  assert.equal(basicStrategy(cards("9", "9"), up("7")), "stand");
  assert.equal(basicStrategy(cards("9", "9"), up("8")), "split");
  assert.equal(basicStrategy(cards("5", "5"), up("9")), "double");
  assert.equal(basicStrategy(cards("4", "4"), up("5")), "split");
  assert.equal(basicStrategy(cards("4", "4"), up("4")), "hit");
  assert.equal(basicStrategy(cards("7", "7"), up("8")), "hit");
  // split not available -> play the total
  assert.equal(basicStrategy(cards("8", "8"), up("10"), { canSplit: false }), "hit");
  assert.equal(basicStrategy(cards("ACE", "ACE"), up("6"), { canSplit: false }), "hit");
});

test("situation labels and Hi-Lo values", () => {
  assert.equal(situationOf(cards("10", "6")), "Hard 16");
  assert.equal(situationOf(cards("ACE", "7")), "Soft 18");
  assert.equal(situationOf(cards("8", "8")), "Pair 8s");
  assert.equal(situationOf(cards("ACE", "ACE")), "Pair As");
  assert.equal(situationOf(cards("KING", "JACK")), "Pair 10s");
  assert.equal(situationOf(cards("ACE", "KING")), "Blackjack");
  assert.equal(situationOf(cards("ACE", "KING"), { fromSplit: true }), "Soft 21");
  assert.deepEqual(["2", "6", "7", "9", "10", "KING", "ACE"].map((v) => hiLoValue(c(v))), [1, 1, 0, 0, -1, -1, -1]);
});
