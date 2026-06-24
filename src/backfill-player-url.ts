/**
 * One-time backfill: set Player URL on every episode that has a Captivate
 * Episode ID. The URL is deterministic, so this is safe to re-run.
 *
 *   npm run backfill-player-url
 */

import { notion, getPublishedEpisodes, captivatePlayerUrl, PROP } from "./notion.js";

async function main(): Promise<void> {
  const rows = await getPublishedEpisodes();
  let updated = 0;

  for (const row of rows) {
    if (!row.captivateEpisodeId) continue;
    await notion.pages.update({
      page_id: row.id,
      properties: { [PROP.playerUrl]: { url: captivatePlayerUrl(row.captivateEpisodeId) } },
    });
    updated++;
    console.log(`  ✓ ${row.title}`);
  }

  console.log(`\nDone. Set Player URL on ${updated} episode(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
