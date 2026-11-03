# Blackjack

A browser Blackjack game built with plain HTML, CSS and JavaScript. Cards are shuffled and dealt by the free [Deck of Cards API](https://deckofcardsapi.com/).

## Features

- **Sign in with Google** (Supabase Auth): a personal greeting with your name and Google profile picture, and a separate saved bankroll for each player
- 6-deck shoe from the API; it reshuffles automatically when 75% of the cards have been dealt
- Hit, Stand, Double Down and Split (up to 4 hands; split aces get one card each)
- Blackjack pays 3:2, dealer stands on all 17s, and the dealer checks for blackjack before you act
- $5 / $25 / $100 / $500 chips, Rebet, and a bankroll that is saved in the browser
- Keyboard shortcuts: **H** hit, **S** stand, **D** double, **P** split, **Enter** deal
- Works on phones and desktops

## How the API is used

| Purpose | Endpoint |
| --- | --- |
| New shuffled 6-deck shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle at the cut card | `GET /api/deck/<deck_id>/shuffle/` |
| Card faces / back | `card.image`, `https://deckofcardsapi.com/static/img/back.png` |

## Project layout

```
index.html          page markup
css/style.css       table, card and control styles
js/auth.js          Supabase client + Google sign-in helpers
js/api.js           Deck of Cards API wrapper
js/blackjack.js     pure game rules (scoring, dealer logic, payouts)
js/app.js           game state, round flow and rendering
tests/              unit tests for the rules (node --test)
netlify.toml        Netlify config (static, no build)
```

## Google sign-in setup (Supabase)

The app uses the Supabase project `xvyfefwjkabjzdqartrt`. The URL and **publishable** key are in `js/auth.js`. That key is meant for browser code; never put the `service_role`/secret key in this repo.

One-time configuration:

1. **Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application)**
   - Authorized redirect URI: `https://xvyfefwjkabjzdqartrt.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Sign In / Providers → Google**: enable it and paste the Google Client ID and Client Secret.
3. **Supabase → Authentication → URL Configuration**
   - **Site URL**: your Netlify URL, e.g. `https://your-site.netlify.app`
   - **Redirect URLs**: add `https://your-site.netlify.app/**` and, for local testing, `http://localhost:3000/**` (or whatever port you use).

If a URL isn't on the Redirect URLs list, Supabase sends users to the Site URL after they sign in.

## Run locally

It's a static site, so any static server works:

```bash
npx serve .
```

Run the tests (Node 18+):

```bash
npm test
```

## Deploy to Netlify

There is no build step. In Netlify, choose **Add new site → Import an existing project**, pick this repo and the `main` branch, leave the build command empty and set the publish directory to `.` (`netlify.toml` already does this). You can also drag the project folder onto Netlify's manual deploy page.
