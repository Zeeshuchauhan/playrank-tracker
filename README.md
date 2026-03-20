# PlayRank Tracker — Deployment Guide

## What This Does
- Adds Play Store apps by URL
- Add keywords (one at a time or bulk — paste many at once)
- Hits the real Google Play Store search page and finds where your app ranks in top 30
- Stores full rank history (90 days) per keyword
- "Check All" button checks every keyword at once with progress indicator
- History tab shows rank changes over time with a visual timeline

---

## Deploy to Vercel (Step by Step)

### Step 1 — Upload files
1. Go to https://github.com and create a new repository called `playrank-tracker`
2. Upload ALL these files keeping the exact folder structure:
   ```
   package.json
   next.config.js
   vercel.json
   pages/
     _app.js
     _document.js
     index.js
     api/
       check-rank.js
       bulk-check.js
   ```

### Step 2 — Deploy on Vercel
1. Go to https://vercel.com and sign in
2. Click "Add New Project"
3. Import your `playrank-tracker` GitHub repo
4. Framework: Next.js (auto-detected)
5. Click "Deploy"

### Step 3 — Done!
Vercel gives you a live URL like: `https://playrank-tracker.vercel.app`

---

## How Ranking Works
The `/api/check-rank` serverless function:
1. Fetches `https://play.google.com/store/search?q=KEYWORD&c=apps&hl=en&gl=US`
2. Extracts all app package IDs from the search result HTML (from href links)
3. Finds your app's package ID in the list and returns its position (1 = top result)
4. If not in top 30, returns "Not Found"

> Note: Google Play Store may occasionally return different results or block scraping.
> The scraper uses real browser headers to minimize this.

---

## Daily Tracking Tips
- Use "Check All" each morning to get fresh rankings
- View the History tab to see rank trends over time
- Green #1-3, Blue #4-10, Amber #11-20, Red #21-30
