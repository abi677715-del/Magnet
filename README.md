# Affiliate Magnet

Finds partner candidates for the **Melbet** affiliate programme and tracks where each one stands. The software does the searching; **a person
does any contacting** and records the result. Nothing is ever sent to anyone.

```
 AI web search  ──►  partners  ──►  Found → Contacted → In progress → Registered  (or Declined)
 (set by your team; nothing is ever sent)
```

## What it does

| Step | How |
|---|---|
| **Find** | One big **Find partners** button searches the public web across YouTube, Telegram, TikTok, Instagram, Facebook, X, Reddit and websites (see below). The same creator found twice is one partner. |
| **Track** | Each partner has a stage you set by hand: **Found → Contacted → In progress → Registered** (or **Declined**), with an optional note. The header shows how many are in each stage, and you can filter the list by stage. Who changed it and when is recorded. |

## Team accounts

Everyone on the team has their own login.

1. **Register.** On the sign-in page, open the **Register** tab and fill in name, work email and a password (8+ characters). This only creates a request.
2. **Approve.** An admin opens the **Admin** page (the badge shows how many are waiting) and presses **Approve** or **Reject**. Nobody can sign in until approved.
3. **Sign in.** Approved people sign in with email and password and stay signed in for 7 days.

The admin page also lets an admin make someone an admin, reset a forgotten password, or switch a person off (they are signed out immediately).
The shared `ADMIN_API_KEY` keeps working as an always-admin login, so you can never lock yourself out. Passwords are stored only as salted scrypt hashes; sessions
are random tokens whose hashes are stored; sign-in and registration are rate limited. Every approval, rejection and role change is written to the audit log.
Actions in the app (like a status change) are recorded under the signed-in person's name.

## Look and feel

The dark-and-yellow Melbet style is set by the CSS variables at the top of `public/style.css`. The logo and banner are `public/brand/logo.svg` and
`public/brand/banner.svg`: they are neutral stand-ins, so replace them with the official files under the same names (see `public/brand/README.txt`).

## Finding partners with AI

Press **Find partners**. It searches every category below in one go:

football channels · sports news pages · prediction/tips creators · sports influencers · betting & prediction communities ·
football websites · public Telegram channels · public Reddit communities · public X accounts · YouTube channels · TikTok, Instagram and Facebook pages with public profiles

Under *Narrow the search* you can add a target country, a language and an extra focus (for example "Swahili-speaking tipsters"). Claude runs web searches
(several per run), and a run takes roughly 1–3 minutes.

**Public information only.** Claude searches the open web like a person would. It cannot and does not look into private groups,
closed channels, invite-only chats or anything behind a login, and no scraping of Reddit, X, TikTok or Instagram is done.

**How made-up results are kept out.** Language models can invent plausible-looking accounts, so each suggestion is checked:
1. its address must have appeared in the real search results Claude was given, otherwise it is rejected (the dashboard lists the rejections and why);
2. YouTube, Telegram and website candidates are re-read from the source itself, so follower counts and published emails are real;
3. for platforms we can't read (X, TikTok, Instagram, Reddit) only the link and Claude's one-line note are kept. The note is labelled
   *unverified*, followers and emails are never taken from it. Add details yourself once you have checked the page.

A search is a list of leads, not an endorsement: check each one yourself before you contact them.

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

Open `/dashboard/` and sign in with your `ADMIN_API_KEY` (under *Sign in with the admin key instead*). That is how the first admin gets in. Then see *Team accounts* below.

## Deploy (Railway)

1. New project → add a **PostgreSQL** database, then a service from this repo. Leave the root directory empty: the `Dockerfile` is at the top of the repo and migrations run on start. (Without the Dockerfile, the `build` and `start` scripts do the same work.)
2. On the **app service** set the variables from `.env.example`. At minimum: `DATABASE_URL` (a reference to the Postgres service), `ADMIN_API_KEY`, `ANTHROPIC_API_KEY`.
3. Open `https://<your-app>/dashboard/`.

Keep this app's database separate from any other project's.

## Settings that shape the results

All in environment variables (see `.env.example`): `PRODUCT_DESCRIPTION` and `IDEAL_AFFILIATE_PROFILE` (what a good partner looks like, used by the AI search),
`AI_DISCOVERY_DAILY_LIMIT` and `AI_DISCOVERY_MAX_SEARCHES`. Changing them never needs a code change.

## Costs

The AI web search is billed per search plus tokens (see Anthropic's pricing page); `DISCOVERY_MODEL` picks the model (default `claude-sonnet-5-5`). Web search must be enabled on your Anthropic account, and a trial account without credits will fail.

## Compliance — please read

This tool helps with the research; **you** are responsible for the programme being lawful and on-brand.

- **Check the rules for each market** where you recruit and where the partner's audience lives. Online betting and its promotion are illegal or restricted in many countries.
- **Follow Melbet's affiliate terms and any marketing guidelines** you have been given. This tool does not know them: put the important ones into `IDEAL_AFFILIATE_PROFILE` and check every lead against them.
- **Only public information is used**, and only from sources that allow it: Claude's web search, the official YouTube API, public Telegram previews, and websites whose `robots.txt` allows it. TikTok, Instagram, Facebook, X and Reddit pages are found through the web search only; the app does not scrape them (that breaks their terms), and it cannot see anything private or behind a login.
- **Contact people yourselves, lawfully.** The app sends nothing. Contact details shown are only ones a site publishes itself. Cold-contacting people has legal rules in many countries (consent, opt-out, sender identity); follow them when you reach out.
- The AI search can be wrong. Check a partner yourself before you contact them. The app no longer screens for under-18 audiences or other red flags, so that check is yours.

## Security notes

- Every API route needs either a signed-in, approved team member or the `ADMIN_API_KEY`; the API refuses everything if the key isn't set. Admin routes need an admin.
- Text from creators' profiles is untrusted: it is never inserted into the page as HTML, it is fenced off from the AI's instructions.
- Pages found by the search are fetched by the server, so private/internal addresses are refused (including after redirects).

## API (all need `Authorization: Bearer <ADMIN_API_KEY>`)

`POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · admin: `GET /admin/users` (`status`), `POST /admin/users/:id/{approve,reject,disable,make-admin,remove-admin,reset-password}` ·
`POST /discovery/ai` (then poll `GET /discovery/ai/:id`) · `POST /discovery/urls` ·
`GET /leads` (`stage`, `platform`, `since`, `q`, `limit`, `offset`) · `GET /leads/stats` · `GET /leads/:id` ·
`PATCH /leads/:id` · `POST /leads/:id/stage` (`FOUND`, `CONTACTED`, `IN_PROGRESS`, `REGISTERED`, `DECLINED`) · `DELETE /leads/:id` · public: `GET /health`.

## Tests

```bash
npm test                               # unit tests, no database needed
DATABASE_URL=... npm run test:e2e      # end-to-end tests against a real database (Claude is faked)
```

## Not built yet

- Direct Reddit/X/TikTok/Instagram APIs (paid or restricted). The AI web search finds their public pages instead, and details can be added by hand.
- Per-person logins and roles.
