# Signal bot — deploy (for the tech team)

The bot reposts approved traders' one-line calls from a private Discord channel to the member
signals channel, and writes every signal to Stock Studio's append-only track record
(`stocks.signals`). Members see the feed and the record at `/signals` in the app. Code:
`scripts/signal-bot.ts`, parser `lib/signals.ts`.

It runs 24/7 on a small Linux box (below: EC2, Amazon Linux 2023, t3.micro). It only makes outbound
connections (Discord, Supabase), so **open no inbound ports**.

## 0. One-time: the bot's database login

The bot connects as its own role, `stocks_signals`, which can only **insert and read** signals —
it can't edit or delete the track record, and it can't touch any other table. Set its password once
in the Supabase SQL editor:

```sql
ALTER ROLE stocks_signals WITH PASSWORD '<long random password>';
```

Its connection string (transaction pooler, port 6543) is
`postgres://stocks_signals.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.

## 1. Install

```bash
sudo dnf install -y nodejs20 git
sudo useradd --system --home /opt/stock-studio --shell /sbin/nologin signalbot
sudo git clone https://github.com/Viral-Ad-Media/stock-studio.git /opt/stock-studio
cd /opt/stock-studio && sudo npm ci
sudo chown -R root:root /opt/stock-studio      # the bot user can run the code, not change it
```

## 2. Secrets — root-only env file

```bash
sudo install -d -m 700 -o root -g root /etc/signal-bot
sudo install -m 600 -o root -g root deploy/signal-bot/env.example /etc/signal-bot/env
sudo nano /etc/signal-bot/env   # fill in the token, channel IDs, poster IDs, database URL
```

- `SIGNAL_POSTER_IDS` is required: the Discord user IDs allowed to post (Discord → Settings →
  Advanced → Developer Mode, then right-click a user → Copy User ID). Anyone else who types in the
  input channel gets a ⛔ and nothing is posted. Add or remove people here, then restart.
- The token is only in that file. It is never in the unit file, the repo, or on a command line.
  If it leaks: Discord Developer Portal → Bot → Reset Token, update the file, restart.

## 3. Service

```bash
sudo cp deploy/signal-bot/signal-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now signal-bot
sudo journalctl -u signal-bot -f
# expect: "signal-bot: logged in as … ; <input> -> <signals>; N approved poster(s)"
```

The service restarts on crash and on reboot, runs as the unprivileged `signalbot` user, and has a
read-only view of the system.

## 4. Verify

From an approved account, post in the input channel:

```
ALERT TEST testing the bot
```

Expect ✅ on your message, a formatted signal in the members channel, and the signal on `/signals`
in the app. From an account not in `SIGNAL_POSTER_IDS`, expect ⛔ and nothing posted.

## Input format

```
ACTION TICKER [CALL|PUT] [@entry] [tp target] [sl stop] notes
BUY GOOGL CALL @12.40 tp 15 sl 11 breakout over 285
EXIT GOOGL taking profits
```

Actions: BUY, SELL, EXIT, CLOSE, ALERT. Tickers like `BRK.B` and `BTC-USD` work. Entry, target and
stop are optional and are shown as separate fields.

## The track record

- Stored in Postgres, not on the instance: replacing or losing the box loses nothing.
- **Append-only.** Updates and deletes are refused by database triggers, for every role.
- **Timestamped by the database**, so a signal can't be backdated.
- **Hash-chained.** Each signal stores a SHA-256 over the previous signal's hash and its own
  fields. `SELECT * FROM stocks.verify_signal_chain();` recomputes the chain and returns the first
  broken signal (null when intact); the app shows the result on `/signals`.
- A signal is recorded **before** it is posted. If posting fails, the poster gets ⚠️ and a reply
  saying the signal is recorded but not posted. A message processed twice is recorded once.
- Editing a message in the input channel doesn't change the recorded signal; the bot replies
  saying so. Post a CLOSE or ALERT to correct a call.

## Updating

```bash
cd /opt/stock-studio && sudo git pull && sudo npm ci && sudo systemctl restart signal-bot
```
