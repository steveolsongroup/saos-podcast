/**
 * One-time backfill: set the MP3 URL on each episode from Captivate's
 * `media_url`. Matches Notion rows to Captivate episodes by Captivate Episode
 * ID. Safe to re-run (just overwrites with the same value).
 *
 *   npm run backfill-audio-url
 */

import { env } from "./env.js";
import { authenticate, getShowEpisodes } from "./captivate.js";
import { notion, getPublishedEpisodes, PROP } from "./notion.js";

async function main(): Promise<void> {
  const token = await authenticate(env.captivateUserId(), env.captivateApiKey());
  const episodes = await getShowEpisodes(token, env.captivateShowId());
  const mp3ById = new Map<string, string>(
    episodes
      .filter((e: any) => e.media_url)
      .map((e: any) => [String(e.id), String(e.media_url)]),
  );

  const rows = await getPublishedEpisodes();
  let updated = 0;
  let missing = 0;

  for (const row of rows) {
    const id = row.captivateEpisodeId;
    if (!id) continue;
    const mp3 = mp3ById.get(id);
    if (!mp3) {
      missing++;
      console.log(`  – no media_url for: ${row.title}`);
      continue;
    }
    await notion.pages.update({
      page_id: row.id,
      properties: { [PROP.mp3Url]: { url: mp3 } },
    });
    updated++;
    console.log(`  ✓ ${row.title}`);
  }

  console.log(`\nDone. Set MP3 URL on ${updated} episode(s)${missing ? `, ${missing} missing` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
