/**
 * Publish poller: Notion -> Captivate.
 *
 * Finds episodes marked "Ready to Publish", uploads their audio to Captivate,
 * creates the episode, and writes the Captivate ids + status back to Notion.
 * Designed to be run on a schedule (GitHub Actions). Safe to re-run: it locks
 * each row to "Publishing" and reuses an already-uploaded media id on retry.
 */

import { env } from "./env.js";
import {
  authenticate,
  uploadMedia,
  createEpisode,
  type EpisodeFields,
} from "./captivate.js";
import {
  getReadyEpisodes,
  setStatus,
  saveMediaId,
  markPublished,
  markError,
  notion,
  STATUS,
  type EpisodeRow,
} from "./notion.js";
import { pageToShowNotesHtml } from "./shownotes.js";

/** Notion date -> Captivate "YYYY-MM-DD HH:MM:SS" (UTC). */
function formatCaptivateDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso.length <= 10 ? `${iso}T09:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function isFuture(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso.length <= 10 ? `${iso}T09:00:00Z` : iso);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

async function downloadAudio(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function publishOne(token: string, ep: EpisodeRow): Promise<void> {
  if (!ep.audioUrl) {
    throw new Error(`No audio file attached on "${ep.title || ep.id}"`);
  }

  // Reuse a media id from a previous partial run; otherwise upload now.
  let mediaId = ep.captivateMediaId;
  if (!mediaId) {
    const filename = ep.audioName || `${(ep.title || "episode").replace(/[^\w.-]+/g, "-")}.mp3`;
    console.log(`  uploading audio (${filename})...`);
    const bytes = await downloadAudio(ep.audioUrl);
    mediaId = await uploadMedia(token, env.captivateShowId(), bytes, filename);
    await saveMediaId(ep.id, mediaId); // persist so a later failure won't re-upload
    console.log(`  media id: ${mediaId}`);
  } else {
    console.log(`  reusing media id: ${mediaId}`);
  }

  const shownotes = await pageToShowNotesHtml(notion, ep.id);
  const scheduled = isFuture(ep.publishDate);

  const fields: EpisodeFields = {
    shows_id: env.captivateShowId(),
    title: ep.title,
    media_id: mediaId,
    date: formatCaptivateDate(ep.publishDate),
    status: scheduled ? "Scheduled" : "Published",
    shownotes: shownotes || ep.summary || "",
    summary: ep.summary || undefined,
    explicit: ep.explicit,
    episode_type: ep.episodeType || "Full",
    episode_number: ep.episodeNumber,
    episode_season: ep.season,
  };

  console.log(`  creating episode (${fields.status})...`);
  const created = await createEpisode(token, fields);
  await markPublished(ep.id, { episodeId: created.id, mediaId, url: created.url });
  console.log(`  ✓ published — episode id ${created.id}${created.url ? ` (${created.url})` : ""}`);
}

async function main(): Promise<void> {
  const ready = await getReadyEpisodes();
  if (ready.length === 0) {
    console.log("No episodes marked 'Ready to Publish'. Nothing to do.");
    return;
  }
  console.log(`Found ${ready.length} episode(s) ready to publish.`);

  const token = await authenticate(env.captivateUserId(), env.captivateApiKey());

  let ok = 0;
  let failed = 0;
  for (const ep of ready) {
    console.log(`\n• ${ep.title || ep.id}`);
    try {
      await setStatus(ep.id, STATUS.publishing); // lock against concurrent runs
      await publishOne(token, ep);
      ok++;
    } catch (err: any) {
      failed++;
      const msg = err?.message ?? String(err);
      console.error(`  ✗ ${msg}`);
      await markError(ep.id, msg).catch(() => {});
    }
  }

  console.log(`\nDone. ${ok} published, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
