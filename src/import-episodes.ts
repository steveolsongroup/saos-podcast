/**
 * One-time backfill: import existing Captivate episodes into the Notion
 * Podcast Episodes DB. Idempotent — skips episodes whose Captivate Episode ID
 * is already present in Notion, so it's safe to re-run.
 *
 *   npm run import
 */

import { env } from "./env.js";
import {
  authenticate,
  getShowEpisodes,
  getEpisodeTotal,
  extractDownloads,
} from "./captivate.js";
import { notion, getPublishedEpisodes, captivatePlayerUrl, PROP, STATUS } from "./notion.js";
import { htmlToBlocks } from "./html-to-blocks.js";

/** Captivate episode_type -> our select option. */
function mapType(t?: string): string {
  switch ((t || "").toLowerCase()) {
    case "trailer":
      return "Trailer";
    case "bonus":
      return "Bonus";
    default:
      return "Full";
  }
}

/** Captivate status -> our select option (only Published has a feed presence). */
function mapStatus(s?: string): string {
  return (s || "").toLowerCase() === "published" ? STATUS.published : STATUS.draft;
}

function isExplicit(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "yes" || s === "explicit" || s === "1";
}

const text = (s: string) => ({ rich_text: [{ text: { content: s.slice(0, 2000) } }] });
const num = (n: unknown) => ({ number: typeof n === "number" ? n : Number(n) || null });

async function main(): Promise<void> {
  const token = await authenticate(env.captivateUserId(), env.captivateApiKey());
  const showId = env.captivateShowId();

  const episodes = await getShowEpisodes(token, showId);
  console.log(`Captivate returned ${episodes.length} episode(s).`);

  // Build the set of Captivate Episode IDs already in Notion (idempotency).
  const existing = new Set(
    (await getPublishedEpisodes()).map((r) => r.captivateEpisodeId).filter(Boolean),
  );

  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  let skipped = 0;

  // Oldest first, so episode order in Notion reads naturally.
  const ordered = [...episodes].sort(
    (a, b) => new Date(a.published_date || 0).getTime() - new Date(b.published_date || 0).getTime(),
  );

  for (const ep of ordered) {
    const id = String(ep.id);
    const title = ep.title || "(untitled)";
    if (existing.has(id)) {
      skipped++;
      console.log(`  – skip (already in Notion): ${title}`);
      continue;
    }

    // Per-episode all-time downloads (best-effort).
    let total = 0;
    try {
      total = extractDownloads(await getEpisodeTotal(token, showId, id));
    } catch {
      /* leave 0 */
    }

    // Captivate's real `summary` field only (the description goes in the body).
    const summary = ep.summary ? String(ep.summary).trim() : "";

    const properties: Record<string, any> = {
      [PROP.title]: { title: [{ text: { content: title } }] },
      [PROP.status]: { select: { name: mapStatus(ep.status) } },
      [PROP.episodeType]: { select: { name: mapType(ep.episode_type) } },
      [PROP.explicit]: { checkbox: isExplicit(ep.explicit) },
      [PROP.captivateEpisodeId]: text(id),
      [PROP.captivateMediaId]: text(String(ep.media_id ?? "")),
      [PROP.playerUrl]: { url: captivatePlayerUrl(id) },
      [PROP.downloadsTotal]: num(total),
      [PROP.lastSynced]: { date: { start: today } },
    };
    if (ep.published_date) properties[PROP.publishDate] = { date: { start: ep.published_date } };
    if (typeof ep.episode_number === "number" || ep.episode_number)
      properties[PROP.episodeNumber] = num(ep.episode_number);
    if (typeof ep.episode_season === "number" || ep.episode_season)
      properties[PROP.season] = num(ep.episode_season);
    if (summary) properties[PROP.summary] = text(summary);
    if (ep.link) properties[PROP.episodeUrl] = { url: String(ep.link) };

    // Description -> page body as real Notion blocks.
    const blocks = htmlToBlocks(String(ep.shownotes ?? ""));
    const page: any = await notion.pages.create({
      parent: { database_id: env.podcastDb() },
      properties,
      ...(blocks.length ? { children: blocks.slice(0, 100) } : {}),
    });
    for (let i = 100; i < blocks.length; i += 100) {
      await notion.blocks.children.append({ block_id: page.id, children: blocks.slice(i, i + 100) });
    }
    created++;
    console.log(`  ✓ imported: ${title}  (downloads: ${total}, ${blocks.length} body block(s))`);
  }

  console.log(`\nDone. Imported ${created}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
