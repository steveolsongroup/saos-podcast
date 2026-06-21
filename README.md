# Podcast: Notion ↔ Captivate

Manage your [Captivate.fm](https://captivate.fm) podcast entirely from Notion.

- **Author** an episode in the **Podcast Episodes** Notion DB (audio + details).
- **Publish** it to Captivate automatically by setting **Status → Ready to Publish**.
- **See stats** on the **Podcast Command Center** Notion page, synced daily from Captivate.

This runs as two scheduled **GitHub Actions** jobs — no server, no Vercel function limits, free.

```
src/captivate.ts   Captivate API client (auth, upload media, create episode, insights)
src/notion.ts      Notion read + write-back helpers (property names live here)
src/shownotes.ts   Notion page body -> HTML show notes
src/publish.ts     poll Notion (Ready to Publish) -> upload + create episode -> write back
src/sync-stats.ts  Captivate insights -> Notion (daily snapshot + per-episode downloads)
src/find-show.ts   one-time: print your Captivate show id
.github/workflows  publish.yml (every 15 min) + stats.yml (daily)
```

## Notion side (already built)

The build created, under a **🎙️ Podcast Command Center** page:

- **Podcast Episodes** DB — `NOTION_PODCAST_DB=157a60a48fc34f2a832784d24644c831`
- **Podcast Stats** DB — `NOTION_PODCAST_STATS_DB=101e953af1d5427d9a9009e1c550c9c1`

> **Important (one-time):** share both databases with your Notion integration **"SAOS LMS
> Connection"** (the one whose token is `NOTION_TOKEN`). In Notion: open each DB as a full page →
> **•••** (top-right) → **Connections** → **Add connections** → choose **SAOS LMS Connection**.
> Until you do this the scripts get `404 object_not_found`.

### Build the stats chart (one click, in Notion)

Open the **Podcast Stats** DB → add a **Chart** view → X axis = `Date`, Y axis = `Total Downloads`
(line). Drop a linked view of it onto the Command Center page. (Charts can't be created via API.)

## Setup

1. **Install**
   ```bash
   npm install
   ```
2. **Get Captivate credentials** — Captivate dashboard → your name (top-right) → **My Account →
   API Key**. Copy the **User ID** and **API Key**.
3. **Configure env**
   ```bash
   cp .env.example .env
   # fill in NOTION_TOKEN, CAPTIVATE_USER_ID, CAPTIVATE_API_KEY
   ```
4. **Find your show id**
   ```bash
   npm run show-id      # prints CAPTIVATE_SHOW_ID=... ; paste it into .env
   ```

## Run locally

```bash
npm run publish      # publish any episodes marked "Ready to Publish"
npm run sync-stats   # pull download stats into Notion
npm run typecheck    # tsc --noEmit
```

## Deploy (GitHub Actions)

1. Push this repo to GitHub.
2. Repo → **Settings → Secrets and variables → Actions** → add:
   `NOTION_TOKEN`, `NOTION_PODCAST_DB`, `NOTION_PODCAST_STATS_DB`,
   `CAPTIVATE_USER_ID`, `CAPTIVATE_API_KEY`, `CAPTIVATE_SHOW_ID`.
3. The two workflows then run on schedule. Test either now via **Actions → (workflow) → Run workflow**.

> A **public** repo gets unlimited Actions minutes (safe here — no secrets are in the code). A
> private repo uses your free Actions minutes; the 15-min publish cadence fits comfortably.

## How publishing works

1. You set an episode's **Status → Ready to Publish**.
2. Within ~15 min the job locks it (**Status → Publishing**), uploads the attached **Audio** to
   Captivate, builds show notes from the page body, and creates the Captivate episode.
3. On success: **Status → Published**, and **Captivate Episode ID** + **Episode URL** are filled in.
4. On failure: **Status → Error** with the reason in the **Error** field. Fix it and set it back to
   **Ready to Publish** — an already-uploaded audio file is reused (no double upload).

A **future Publish Date** is sent to Captivate as `Scheduled`; otherwise it publishes immediately.

## Notes

- Audio attached in Notion requires a **paid Notion plan** (free Notion caps uploads at 5 MB). If you
  ever hit that, switch the `Audio` handling to a direct URL field — small change in `src/notion.ts`.
- Captivate's insights payload shapes vary by endpoint; `extractDownloads()` in `src/captivate.ts`
  pulls the download number defensively. If a number looks off, log the raw payload there to inspect.
