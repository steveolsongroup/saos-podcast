/**
 * One-time migration: move each imported episode's description from the Summary
 * property into the page BODY as real Notion blocks, and clear the Summary
 * property (Captivate's actual `summary` field was empty on these episodes).
 *
 * Idempotent: skips appending to any page that already has body content.
 *
 *   npm run fix-shownotes
 */

import { env } from "./env.js";
import { authenticate, getShowEpisodes } from "./captivate.js";
import { notion, getPublishedEpisodes, PROP } from "./notion.js";
import { htmlToBlocks } from "./html-to-blocks.js";

/** Does this page already have meaningful body content? */
async function hasBody(pageId: string): Promise<boolean> {
  const res = await notion.blocks.children.list({ block_id: pageId, page_size: 5 });
  return res.results.some((b: any) => b.type !== "divider");
}

async function appendInChunks(pageId: string, blocks: any[]): Promise<void> {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + 100),
    });
  }
}

async function main(): Promise<void> {
  const token = await authenticate(env.captivateUserId(), env.captivateApiKey());
  const episodes = await getShowEpisodes(token, env.captivateShowId());
  const notesById = new Map<string, string>(
    episodes.map((e: any) => [String(e.id), String(e.shownotes ?? "")]),
  );

  const rows = await getPublishedEpisodes();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row.captivateEpisodeId;
    if (!id) continue;
    const html = notesById.get(id);

    if (html && html.trim()) {
      if (await hasBody(row.id)) {
        console.log(`  – body already present, leaving as-is: ${row.title}`);
        skipped++;
      } else {
        const blocks = htmlToBlocks(html);
        if (blocks.length) {
          await appendInChunks(row.id, blocks);
          console.log(`  ✓ wrote ${blocks.length} block(s) to body: ${row.title}`);
          updated++;
        }
      }
    }

    // Clear the Summary property (it held the description as plain text).
    await notion.pages.update({
      page_id: row.id,
      properties: { [PROP.summary]: { rich_text: [] } },
    });
  }

  console.log(`\nDone. Bodies written: ${updated}, skipped: ${skipped}. Summary cleared on all.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
