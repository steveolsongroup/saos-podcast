/**
 * Stats sync: Captivate -> Notion.
 *
 * Writes a daily show-level snapshot row into the Podcast Stats DB (for charts)
 * and updates per-episode download numbers on the Podcast Episodes DB.
 * Designed to run once a day via GitHub Actions.
 */

import { env } from "./env.js";
import {
  authenticate,
  getShowTotal,
  getShowOverview,
  getEpisodeTotal,
  getEpisodeOverview,
  extractDownloads,
} from "./captivate.js";
import {
  getPublishedEpisodes,
  appendStatsSnapshot,
  updateEpisodeStats,
} from "./notion.js";

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  const token = await authenticate(env.captivateUserId(), env.captivateApiKey());
  const showId = env.captivateShowId();

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const start = ymd(monthAgo);
  const end = ymd(today);

  // --- show-level snapshot ---
  const episodes = await getPublishedEpisodes();
  const showTotal = extractDownloads(await getShowTotal(token, showId));
  let showLast30 = 0;
  try {
    showLast30 = extractDownloads(await getShowOverview(token, showId, start, end));
  } catch (err: any) {
    console.warn(`  show overview unavailable: ${err?.message ?? err}`);
  }

  await appendStatsSnapshot({
    date: end,
    total: showTotal,
    last30: showLast30,
    episodes: episodes.length,
  });
  console.log(
    `Snapshot ${end}: total=${showTotal}, 30d=${showLast30}, episodes=${episodes.length}`,
  );

  // --- per-episode ---
  let updated = 0;
  for (const ep of episodes) {
    if (!ep.captivateEpisodeId) continue;
    try {
      const total = extractDownloads(await getEpisodeTotal(token, showId, ep.captivateEpisodeId));
      let last30 = 0;
      try {
        last30 = extractDownloads(
          await getEpisodeOverview(token, showId, ep.captivateEpisodeId, start, end),
        );
      } catch {
        /* per-episode overview may be unavailable; leave as 0 */
      }
      await updateEpisodeStats(ep.id, { total, last30, syncedAt: end });
      updated++;
      console.log(`  • ${ep.title}: total=${total}, 30d=${last30}`);
    } catch (err: any) {
      console.error(`  ✗ ${ep.title}: ${err?.message ?? err}`);
    }
  }

  console.log(`\nDone. Updated ${updated}/${episodes.length} episodes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
