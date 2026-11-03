import * as api from "./api.js";
import {
  signInWithGoogle,
  signOut,
  onUserChange,
  oauthErrorFromUrl,
  cleanAuthParamsFromUrl,
  profileOf,
} from "./auth.js";
import { CARD_BACK } from "./api.js";
import {
  handScore,
  isBlackjack,
  isBust,
  canSplit,
  dealerShouldHit,
  settleHand,
} from "./blackjack.js";

const DECK_COUNT = 6;
const SHOE_SIZE = DECK_COUNT * 52;
const RESHUFFLE_AT = Math.floor(SHOE_SIZE * 0.25); // cut card at 75% penetration
const STARTING_BANKROLL = 1000;
const MAX_HANDS = 4;
let storageKey = "blackjack.bankroll"; // made per-player once someone signs in
const DEAL_DELAY = 350;

const state = {
  deckId: null,
  remaining: 0,
  player: null,
  bankroll: STARTING_BANKROLL,
  bet: 0,
  lastBet: 0,
  phase: "betting", // betting | playing | dealer | done
  hands: [], // { cards, bet, done, fromSplit, result }
  active: 0,
  dealer: [],
  holeHidden: true,
  busy: false,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  bankroll: $("bankroll"),
  shoe: $("shoe"),
  bet: $("current-bet"),
  message: $("message"),
  dealerCards: $("dealer-cards"),
  dealerScore: $("dealer-score"),
  playerHands: $("player-hands"),
  betting: $("betting-controls"),
  actions: $("action-controls"),
  broke: $("broke-controls"),
  deal: $("btn-deal"),
  clear: $("btn-clear"),
  rebet: $("btn-rebet"),
  hit: $("btn-hit"),
  stand: $("btn-stand"),
  double: $("btn-double"),
  split: $("btn-split"),
  reset: $("btn-reset"),
  chips: document.querySelectorAll("[data-chip]"),
};

// ---------- Persistence ----------
function loadBankroll() {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? saved : STARTING_BANKROLL;
  } catch {
    return STARTING_BANKROLL;
  }
}

function saveBankroll() {
  try {
    localStorage.setItem(storageKey, String(state.bankroll));
  } catch {
    /* storage unavailable — ignore */
  }
}

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function setMessage(text, tone = "") {
  el.message.textContent = text;
  el.message.className = "message" + (tone ? " " + tone : "");
}

async function withBusy(fn) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setMessage(`Couldn't reach the card dealer: ${err.message}. Try again.`, "lose");
  } finally {
    state.busy = false;
    render();
  }
}

async function ensureShoe() {
  if (!state.deckId) {
    setMessage("Shuffling a fresh 6-deck shoe…");
    const data = await api.newShoe(DECK_COUNT);
    state.deckId = data.deck_id;
    state.remaining = data.remaining;
  } else if (state.remaining < RESHUFFLE_AT) {
    setMessage("Cut card reached — reshuffling the shoe…");
    try {
      const data = await api.reshuffle(state.deckId);
      state.remaining = data.remaining;
    } catch {
      state.deckId = null; // deck expired on the server — open a new one
      return ensureShoe();
    }
    await sleep(600);
  }
}

async function drawCards(count) {
  const data = await api.draw(state.deckId, count);
  state.remaining = data.remaining;
  if (data.cards.length < count) throw new Error("The shoe ran out of cards");
  return data.cards;
}

const currentHand = () => state.hands[state.active];

// ---------- Betting ----------
function addChip(amount) {
  if (state.phase !== "betting" && state.phase !== "done") return;
  if (state.phase === "done") startBetting();
  if (state.bet + amount > state.bankroll) {
    setMessage("Not enough chips for that bet");
    return;
  }
  state.bet += amount;
  setMessage("Press Deal when ready");
  render();
}

function clearBet() {
  state.bet = 0;
  setMessage("Place your bet to begin");
  render();
}

function rebet() {
  if (state.phase === "done") startBetting();
  state.bet = Math.min(state.lastBet, state.bankroll);
  render();
}

function startBetting() {
  state.phase = "betting";
  state.hands = [];
  state.dealer = [];
  state.bet = 0;
  setMessage("Place your bet to begin");
}

function resetBankroll() {
  state.bankroll = STARTING_BANKROLL;
  saveBankroll();
  startBetting();
  render();
}

// ---------- Round flow ----------
function deal() {
  if (state.phase === "done" && state.bet === 0 && state.lastBet > 0) rebet();
  if (state.bet <= 0 || state.bet > state.bankroll) return;

  withBusy(async () => {
    await ensureShoe();

    const bet = state.bet;
    state.bankroll -= bet;
    state.lastBet = bet;
    state.bet = 0;
    saveBankroll();

    state.hands = [{ cards: [], bet, done: false, fromSplit: false, result: null }];
    state.active = 0;
    state.dealer = [];
    state.holeHidden = true;
    state.phase = "playing";
    setMessage("Dealing…");
    render();

    let p1, d1, p2, d2;
    try {
      [p1, d1, p2, d2] = await drawCards(4);
    } catch (err) {
      // Refund and start over with a fresh shoe next time.
      state.bankroll += bet;
      state.bet = bet;
      state.deckId = null;
      saveBankroll();
      state.phase = "betting";
      state.hands = [];
      throw err;
    }
    for (const [target, card] of [
      [state.hands[0].cards, p1],
      [state.dealer, d1],
      [state.hands[0].cards, p2],
      [state.dealer, d2],
    ]) {
      target.push(card);
      render();
      await sleep(DEAL_DELAY);
    }

    const playerBJ = isBlackjack(state.hands[0].cards);
    const dealerBJ = isBlackjack(state.dealer);
    if (playerBJ || dealerBJ) {
      // Dealer peeks / player natural — round ends immediately.
      state.hands[0].done = true;
      await revealHole();
      finishRound();
      return;
    }

    setMessage("Hit or stand?");
  });
}

function hit() {
  if (state.phase !== "playing") return;
  withBusy(async () => {
    const hand = currentHand();
    const [card] = await drawCards(1);
    hand.cards.push(card);
    render();
    await sleep(DEAL_DELAY);

    if (isBust(hand.cards)) {
      hand.done = true;
      hand.result = "bust";
      await nextHand();
    } else if (handScore(hand.cards).total === 21) {
      hand.done = true;
      await nextHand();
    }
  });
}

function stand() {
  if (state.phase === "dealer") return withBusy(playDealer); // retry after a network error
  if (state.phase !== "playing") return;
  withBusy(async () => {
    currentHand().done = true;
    await nextHand();
  });
}

function doubleDown() {
  if (!canDouble()) return;
  withBusy(async () => {
    const hand = currentHand();
    state.bankroll -= hand.bet;
    hand.bet *= 2;
    saveBankroll();

    const [card] = await drawCards(1);
    hand.cards.push(card);
    hand.done = true;
    if (isBust(hand.cards)) hand.result = "bust";
    render();
    await sleep(DEAL_DELAY);
    await nextHand();
  });
}

function split() {
  if (!canSplitNow()) return;
  withBusy(async () => {
    const hand = currentHand();
    const splittingAces = hand.cards[0].value === "ACE";
    state.bankroll -= hand.bet;
    saveBankroll();

    const second = {
      cards: [hand.cards.pop()],
      bet: hand.bet,
      done: false,
      fromSplit: true,
      result: null,
    };
    hand.fromSplit = true;
    state.hands.splice(state.active + 1, 0, second);
    render();
    await sleep(DEAL_DELAY);

    const [c1, c2] = await drawCards(2);
    hand.cards.push(c1);
    render();
    await sleep(DEAL_DELAY);
    second.cards.push(c2);
    render();
    await sleep(DEAL_DELAY);

    if (splittingAces) {
      // Split aces receive one card each.
      hand.done = true;
      second.done = true;
      await nextHand();
    } else {
      await nextHand(); // auto-stands a 21, otherwise prompts for this hand
    }
  });
}

async function nextHand() {
  // Find the next hand that still needs playing.
  while (state.active < state.hands.length) {
    const hand = currentHand();
    if (!hand.done) {
      if (handScore(hand.cards).total === 21) {
        hand.done = true;
      } else {
        setMessage(state.hands.length > 1 ? `Hand ${state.active + 1}: hit or stand?` : "Hit or stand?");
        render();
        return;
      }
    }
    state.active++;
  }
  await playDealer();
}

async function revealHole() {
  state.holeHidden = false;
  render();
  await sleep(DEAL_DELAY + 200);
}

async function playDealer() {
  state.phase = "dealer";
  setMessage("Dealer's turn…");
  await revealHole();

  const anyLive = state.hands.some((h) => !isBust(h.cards));
  if (anyLive) {
    while (dealerShouldHit(state.dealer)) {
      const [card] = await drawCards(1);
      state.dealer.push(card);
      render();
      await sleep(DEAL_DELAY + 150);
    }
  }
  finishRound();
}

function finishRound() {
  let returned = 0;
  let staked = 0;
  for (const hand of state.hands) {
    const { outcome, payout } = settleHand(hand, state.dealer);
    hand.result = outcome;
    returned += payout;
    staked += hand.bet;
  }
  state.bankroll += returned;
  saveBankroll();

  const net = returned - staked;
  const single = state.hands.length === 1 ? state.hands[0].result : null;
  const dealerBJ = isBlackjack(state.dealer);

  if (single === "blackjack") setMessage(`Blackjack! You win ${money(net)}`, "win");
  else if (single === "bust") setMessage(`Bust! You lose ${money(-net)}`, "lose");
  else if (dealerBJ && net < 0) setMessage(`Dealer has Blackjack. You lose ${money(-net)}`, "lose");
  else if (net > 0) setMessage(`You win ${money(net)}!`, "win");
  else if (net < 0) setMessage(`Dealer wins. You lose ${money(-net)}`, "lose");
  else if (single) setMessage("Push — your bet is returned", "push");
  else setMessage("You broke even this round", "push");

  state.phase = "done";
  state.active = -1;
}

// ---------- Rule checks for buttons ----------
function canDouble() {
  if (state.phase !== "playing") return false;
  const hand = currentHand();
  return !!hand && hand.cards.length === 2 && state.bankroll >= hand.bet;
}

function canSplitNow() {
  if (state.phase !== "playing") return false;
  const hand = currentHand();
  return (
    !!hand &&
    canSplit(hand.cards) &&
    state.hands.length < MAX_HANDS &&
    state.bankroll >= hand.bet
  );
}

// ---------- Rendering ----------
function cardEl(card, faceDown = false) {
  const wrap = document.createElement("div");
  wrap.className = "card" + (faceDown ? " face-down" : "");
  wrap.dataset.code = card.code;

  const inner = document.createElement("div");
  inner.className = "card-inner";

  const front = document.createElement("img");
  front.className = "front";
  front.src = card.image;
  front.alt = faceDown ? "" : `${card.value} of ${card.suit}`.toLowerCase();

  const back = document.createElement("img");
  back.className = "back";
  back.src = CARD_BACK;
  back.alt = faceDown ? "Face-down card" : "";

  inner.append(front, back);
  wrap.append(inner);
  return wrap;
}

/** Update a card row without re-creating cards that are already on screen. */
function renderCards(container, cards, hideIndex = -1) {
  // Drop cards from the first mismatch onward (new round, split, ...).
  const nodes = [...container.children];
  const keep = nodes.findIndex((node, i) => !cards[i] || node.dataset.code !== cards[i].code);
  if (keep !== -1) nodes.slice(keep).forEach((node) => node.remove());
  cards.forEach((card, i) => {
    const node = container.children[i] || container.appendChild(cardEl(card, i === hideIndex));
    node.classList.toggle("face-down", i === hideIndex);
    node.querySelector(".front").alt = i === hideIndex ? "" : `${card.value} of ${card.suit}`.toLowerCase();
  });
}

function scoreText(cards, canBeNatural = true) {
  const { total, soft } = handScore(cards);
  if (canBeNatural && isBlackjack(cards)) return "BJ";
  const showBoth = soft && total < 21 && state.phase !== "done";
  return showBoth ? `${total - 10}/${total}` : String(total);
}

const RESULT_LABEL = {
  blackjack: "Blackjack",
  win: "Win",
  lose: "Lose",
  bust: "Bust",
  push: "Push",
};

function renderHands() {
  // Keep one DOM node per hand so card animations only run for new cards.
  while (el.playerHands.children.length > state.hands.length) {
    el.playerHands.lastChild.remove();
  }
  state.hands.forEach((hand, i) => {
    let node = el.playerHands.children[i];
    if (!node) {
      node = document.createElement("div");
      node.className = "hand";
      node.innerHTML =
        '<div class="cards"></div><div class="hand-info"><span class="score"></span><span class="hand-bet"></span><span class="hand-result" hidden></span></div>';
      el.playerHands.appendChild(node);
    }
    node.classList.toggle("active", state.phase === "playing" && i === state.active && state.hands.length > 1);
    renderCards(node.querySelector(".cards"), hand.cards);

    const score = node.querySelector(".score");
    score.textContent = hand.cards.length ? scoreText(hand.cards, !hand.fromSplit) : "";
    score.hidden = !hand.cards.length;
    node.querySelector(".hand-bet").textContent = money(hand.bet);

    const result = node.querySelector(".hand-result");
    const showResult = hand.result && (state.phase === "done" || hand.result === "bust");
    result.hidden = !showResult;
    if (showResult) {
      result.textContent = RESULT_LABEL[hand.result];
      result.className = "hand-result " + hand.result;
    }
  });
}

function render() {
  el.bankroll.textContent = money(state.bankroll);
  el.shoe.textContent = state.deckId ? `${state.remaining} cards` : "—";
  el.bet.textContent = money(state.bet);

  // Dealer
  const hideIndex = state.holeHidden ? 1 : -1;
  renderCards(el.dealerCards, state.dealer, hideIndex);
  if (state.dealer.length) {
    el.dealerScore.hidden = false;
    el.dealerScore.textContent = state.holeHidden
      ? scoreText([state.dealer[0]])
      : scoreText(state.dealer);
  } else {
    el.dealerScore.hidden = true;
  }

  renderHands();

  // Controls
  const inRound = state.phase === "playing" || state.phase === "dealer";
  const broke = !inRound && state.bankroll < 5 && state.bet === 0;
  el.betting.hidden = inRound || broke;
  el.actions.hidden = !inRound;
  el.broke.hidden = !broke;

  const b = state.busy;
  el.chips.forEach((chip) => {
    chip.disabled = b || Number(chip.dataset.chip) > state.bankroll - (state.phase === "done" ? 0 : state.bet);
  });
  el.clear.disabled = b || state.bet === 0;
  el.rebet.hidden = !(state.phase === "done" && state.lastBet > 0);
  el.rebet.disabled = b || state.lastBet > state.bankroll;
  el.deal.disabled = b || (state.bet === 0 && !(state.phase === "done" && state.lastBet > 0 && state.lastBet <= state.bankroll));
  el.deal.textContent = state.phase === "done" && state.bet === 0 && state.lastBet > 0 ? `Deal ${money(state.lastBet)}` : "Deal";

  const playing = state.phase === "playing" && !b;
  el.hit.disabled = !playing;
  el.stand.disabled = !(playing || (state.phase === "dealer" && !b));
  el.double.disabled = !playing || !canDouble();
  el.split.disabled = !playing || !canSplitNow();
}

// ---------- Events ----------
el.chips.forEach((chip) => chip.addEventListener("click", () => addChip(Number(chip.dataset.chip))));
el.clear.addEventListener("click", clearBet);
el.rebet.addEventListener("click", rebet);
el.deal.addEventListener("click", deal);
el.hit.addEventListener("click", hit);
el.stand.addEventListener("click", stand);
el.double.addEventListener("click", doubleDown);
el.split.addEventListener("click", split);
el.reset.addEventListener("click", resetBankroll);

document.addEventListener("keydown", (e) => {
  if (!state.player) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();
  if (state.phase === "playing") {
    if (key === "h") hit();
    else if (key === "s") stand();
    else if (key === "d") doubleDown();
    else if (key === "p") split();
  } else if (key === "enter" && !el.deal.disabled && document.activeElement?.tagName !== "BUTTON") {
    deal();
  }
});

// ---------- Sign-in ----------
const auth = {
  loading: $("loading-screen"),
  login: $("login-screen"),
  game: $("game"),
  google: $("btn-google"),
  error: $("login-error"),
  signout: $("btn-signout"),
  avatar: $("user-avatar"),
  initials: $("user-initials"),
  greeting: $("user-greeting"),
};

function showLoginError(text) {
  auth.error.textContent = text;
  auth.error.hidden = !text;
}

function greetingFor(firstName) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${firstName}!`;
}

function showPlayer(profile) {
  auth.greeting.textContent = greetingFor(profile.firstName);
  auth.greeting.title = profile.email;
  auth.initials.textContent = profile.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  auth.initials.hidden = false;
  auth.avatar.hidden = true;
  if (profile.avatar) {
    auth.avatar.onload = () => {
      auth.avatar.hidden = false;
      auth.initials.hidden = true;
    };
    auth.avatar.onerror = () => {
      auth.avatar.hidden = true;
      auth.initials.hidden = false;
    };
    auth.avatar.alt = profile.name;
    auth.avatar.src = profile.avatar;
  }
}

function handleUser(user) {
  document.body.classList.remove("auth-loading");
  auth.loading.hidden = true;
  cleanAuthParamsFromUrl();

  if (!user) {
    state.player = null;
    auth.game.hidden = true;
    auth.login.hidden = false;
    auth.google.disabled = false;
    return;
  }

  const profile = profileOf(user);
  state.player = profile;
  storageKey = `blackjack.bankroll.${profile.id}`; // each player keeps their own chips
  state.bankroll = loadBankroll();
  state.deckId = null;
  state.lastBet = 0;
  startBetting();
  setMessage(`Welcome to the table, ${profile.firstName}. Place your bet to begin`);

  showPlayer(profile);
  showLoginError("");
  auth.login.hidden = true;
  auth.game.hidden = false;
  render();
}

auth.google.addEventListener("click", async () => {
  auth.google.disabled = true;
  showLoginError("");
  try {
    await signInWithGoogle(); // navigates away to Google
  } catch (err) {
    console.error(err);
    showLoginError(`Couldn't start Google sign-in: ${err.message}`);
    auth.google.disabled = false;
  }
});

auth.signout.addEventListener("click", async () => {
  if (state.busy || state.phase === "playing" || state.phase === "dealer") {
    if (!confirm("Sign out in the middle of a hand? Your current bet will be lost.")) return;
  }
  auth.signout.disabled = true;
  try {
    await signOut();
  } catch (err) {
    console.error(err);
    handleUser(null); // clear the UI even if the network call failed
  } finally {
    auth.signout.disabled = false;
  }
});

const redirectError = oauthErrorFromUrl();
onUserChange((user) => {
  handleUser(user);
  if (!user && redirectError) showLoginError(`Sign-in failed: ${redirectError}`);
});
