# Affiliate Magnet

Finds and scores affiliate partner candidates for the **Melbet** affiliate programme. The software does the searching and the first
assessment; **a person decides** who goes on the shortlist and does any contacting. Nothing is ever sent to anyone.

```
 DISCOVERY                         AI                          PEOPLE
 AI web search ──┐
 YouTube search ─┼─► leads ─► Claude scores 0-100 ─► priority ─► manager review ─► shortlist ─► CSV export
 Pasted links ───┤            (+ compliance flags)    leads      shortlist / not a fit
 CSV import ─────┘
```

## What it does

| Step | How |
|---|---|
| **Find** | **AI web search** (Claude searches the public web by category — see below), YouTube keyword search (official API), pasted links (YouTube, Telegram, websites), and CSV/JSON import. The same creator found twice is one lead. |
| **Score** | Claude reads the public profile and rates audience fit, content fit, credibility and promo experience. **Reach is calculated from the real follower count, not guessed.** The final 0-100 score is a weighted sum computed in code (weights are configurable), so it is transparent and repeatable. |
| **Protect the brand** | Hard disqualifiers: audience that may include under-18s, "fixed match"/sure-tip scams, illegal or hateful content, and leads outside your target countries. They cap the score low and **cannot be added to the shortlist**. Softer flags (guaranteed-win claims, fake engagement, spam, adult content) cap the score at 45 and keep the lead out of "priority". |
| **Review** | The dashboard lists priority leads with the score breakdown, strengths, concerns and flags. A manager adds to the shortlist or marks "not a fit". Every decision is recorded (who, when). |
| **Take it out** | **Export to CSV** downloads the leads you are looking at (any tab or filter), best score first, with links, scores, flags and any public contact email — ready for your team to work from. |

## Finding partners with AI

On **Add leads → Find partners with AI**, pick categories and press *Search the web*:

football channels · sports news pages · prediction/tips creators · sports influencers · betting & prediction communities ·
football websites · public Telegram channels · public Reddit communities · public X accounts · YouTube channels · TikTok creators with public profiles

Optionally add a target country, a language and an extra focus (for example "Swahili-speaking tipsters"). Claude runs web searches
(several per run), and a run takes roughly 1–3 minutes.

**Public information only.** Claude searches the open web like a person would. It cannot and does not look into private groups,
closed channels, invite-only chats or anything behind a login, and no scraping of Reddit, X, TikTok or Instagram is done.

**How made-up results are kept out.** Language models can invent plausible-looking accounts, so each suggestion is checked:
1. its address must have appeared in the real search results Claude was given, otherwise it is rejected (the dashboard lists the rejections and why);
2. YouTube, Telegram and website candidates are re-read from the source itself, so follower counts and published emails are real;
3. for platforms we can't read (X, TikTok, Instagram, Reddit) only the link and Claude's one-line note are kept. The note is labelled
   *unverified*, followers and emails are never taken from it, and the scorer treats it as weak evidence (credibility and audience fit capped at 60) until a person adds details.

A search is not a verdict: after it, press **Score new leads**, then review.

Controls: one search at a time, `AI_DISCOVERY_DAILY_LIMIT` runs per day (default 20) and `AI_DISCOVERY_MAX_SEARCHES` web searches per run (default 10).
The search tool is billed per search on top of the normal token cost, so keep those limits modest while you learn what a run costs.

## Run it locally

Needs Node 20+ and PostgreSQL.

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, ADMIN_API_KEY, ANTHROPIC_API_KEY
npm run build
npm start                    # applies database migrations, then serves http://localhost:4100/dashboard/
```

Open `/dashboard/`, sign in with your `ADMIN_API_KEY`, and add some leads.

## Deploy (Railway)

1. New project → add a **PostgreSQL** database, then a service from this repo. Leave the root directory empty: the `Dockerfile` is at the top of the repo and migrations run on start. (Without the Dockerfile, the `build` and `start` scripts do the same work.)
2. On the **app service** set the variables from `.env.example`. At minimum: `DATABASE_URL` (a reference to the Postgres service), `ADMIN_API_KEY`, `ANTHROPIC_API_KEY`.
3. Open `https://<your-app>/dashboard/`.

Keep this app's database separate from any other project's.

## Settings that shape the results

All in environment variables (see `.env.example`): `PRODUCT_DESCRIPTION` and `IDEAL_AFFILIATE_PROFILE` (what a good partner looks like),
`ALLOWED_COUNTRIES`, `PRIORITY_THRESHOLD`, and the `WEIGHT_*` values. Changing them never needs a code change.

## Costs

Scoring uses one Claude call per lead. Models default to the most capable (`claude-opus-5-5`); set `CLASSIFIER_MODEL` /
`DISCOVERY_MODEL` to a cheaper model if you score thousands of leads. The AI web search is billed per search plus tokens
(see Anthropic's pricing page). YouTube keyword search costs about 100 of the 10,000 free daily quota units per search.

## Compliance — please read

This tool helps with the research; **you** are responsible for the programme being lawful and on-brand.

- **Check the rules for each market** where you recruit and where the partner's audience lives. Online betting and its promotion are illegal or restricted in many countries. Use `ALLOWED_COUNTRIES`.
- **Follow Melbet's affiliate terms and any marketing guidelines** you have been given. This tool does not know them: put the important ones into `IDEAL_AFFILIATE_PROFILE` and review every lead against them.
- **Only public information is used**, and only from sources that allow it: Claude's web search, the official YouTube API, public Telegram previews, and websites whose `robots.txt` allows it. TikTok, Instagram and X are import-only on purpose (scraping them breaks their terms).
- **Contact people yourselves, lawfully.** The app sends nothing. Contact details shown are only ones a site publishes itself. Cold-contacting people has legal rules in many countries (consent, opt-out, sender identity); follow them when you reach out.
- AI scores are a first filter, not a verdict. Read the evidence before shortlisting.

## Security notes

- One shared team key (`ADMIN_API_KEY`) protects the dashboard and API; the API refuses everything if it isn't set. For a larger team, put it behind your company's login/VPN.
- Text from creators' profiles is untrusted: it is never inserted into the page as HTML, it is fenced off from the AI's instructions, and in the CSV export cells that could run as spreadsheet formulas are neutralised.
- Pasted URLs are fetched by the server, so private/internal addresses are refused (including after redirects). Only managers with the key can trigger a fetch.

## API (all need `Authorization: Bearer <ADMIN_API_KEY>`)

`POST /discovery/ai` (then poll `GET /discovery/ai/:id`) · `POST /discovery/youtube` · `POST /discovery/urls` · `POST /discovery/import` · `POST /classification/run` ·
`GET /leads` (`status`, `platform`, `minScore`, `priority`, `needsAttention`, `q`, `limit`, `offset`) · `GET /leads/export` (same filters, CSV) · `GET /leads/stats` · `GET /leads/:id` ·
`PATCH /leads/:id` · `POST /leads/:id/{approve,reject,rescore}` · public: `GET /health`.

## Tests

```bash
npm test                               # unit tests, no database needed
DATABASE_URL=... npm run test:e2e      # end-to-end tests against a real database (Claude is faked)
```

## Not built yet

- Direct Reddit/X/TikTok/Instagram APIs (paid or restricted). The AI web search finds their public pages instead, and details can be imported.
- Per-person logins and roles.
