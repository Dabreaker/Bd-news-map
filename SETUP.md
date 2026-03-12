# BD-NewsMap — Two App Setup Guide

## Overview

```
[User Browser]
     ↓  HTTPS
[Vercel App]  ←── serves HTML/JS, proxies all API calls
     ↓  HTTPS (tor2web gateway)
[Tor Network]
     ↓  Tor circuit
[Your Phone — Termux]
  storage.js on port 8080
  SQLite + files — all data lives here
```

---

## PART 1 — Phone Storage (do this first)

### Install & start

```bash
# In Termux
pkg update && pkg upgrade -y
pkg install nodejs-lts git -y

# Copy bdnm-phone to your Termux home
cd ~
# (extract the zip here)
cd bdnm-phone

npm install

# Edit .env — change both secrets to random strings
nano .env

# First time: install Tor + generate your .onion address (~60 seconds)
bash setup-tor.sh
```

The script prints your `.onion` address and saves it to `db_link.txt`.
**Example output:**
```
http://abc123xyz789abcdef.onion
Saved to db_link.txt
```

### Start every time

```bash
cd ~/bdnm-phone
bash start.sh
```

This starts Tor + the storage server on port 8080.

### Keep it running

In Termux: Settings → (disable battery optimization for Termux)
Or use `tmux` to keep it alive:
```bash
pkg install tmux
tmux new -s storage
bash start.sh
# Ctrl+B then D to detach
```

---

## PART 2 — Vercel App

### 1. Push to GitHub

```bash
cd bdnm-vercel
git init
git add .
git commit -m "BD-NewsMap Vercel app"
git remote add origin https://github.com/YOUR_USERNAME/bdnm-vercel.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to vercel.com → New Project → Import your GitHub repo
2. Framework Preset: **Other**
3. Click Deploy (it will fail — that's fine, you need env vars first)

### 3. Set Environment Variables

Vercel Dashboard → Your Project → Settings → Environment Variables

| Variable | Value |
|---|---|
| `STORAGE_URL` | Contents of `db_link.txt` on your phone e.g. `http://abc123.onion` |
| `WRITE_SECRET` | Same value as `WRITE_SECRET` in your phone's `.env` |

### 4. Redeploy

Vercel Dashboard → Deployments → Redeploy

---

## How it works

1. User opens your Vercel URL in their browser
2. Browser loads HTML/JS from Vercel (fast, CDN)
3. App calls `/api/feed` → Vercel function converts `.onion` URL to `https://abc123.onion.ws`
4. Vercel fetches from tor2web gateway → data travels through Tor → reaches your phone
5. Your phone responds → data flows back → user sees news

### Image URLs

Images stored on your phone as `/files/<id>/img_0.jpg`
Vercel rewrites these to `https://abc123.onion.ws/files/<id>/img_0.jpg` automatically
Browser loads images directly from tor2web — no Vercel bandwidth used

---

## What tor2web is

`onion.ws` is a free tor2web gateway — it bridges normal HTTPS to .onion addresses.
Your phone only needs to run Tor + the storage server.
No clearnet hosting needed. No cost.

---

## Backup your .onion identity

Your `.onion` address is permanent as long as this folder exists:
```
~/bdnm-phone/tor_data/hidden_service/
```
Back it up. If lost, your address changes and you need to update STORAGE_URL in Vercel.

---

## Troubleshooting

**App shows "স্টোরেজ সার্ভার পাওয়া যাচ্ছে না"**
→ Phone is offline, Tor isn't running, or STORAGE_URL is wrong
→ Check: `curl https://YOUR_ONION.onion.ws/health`

**Tor takes too long to connect**
→ Normal on first start, takes 30-90 seconds
→ Bangladesh ISPs sometimes throttle Tor — try: `pkg install obfs4proxy`

**Images not loading**
→ onion.ws may be slow — this is normal for Tor
→ Images load async, give it a few seconds
