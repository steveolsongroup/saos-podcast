/**
 * One-time helper: print the shows on your Captivate account so you can grab
 * the show id for CAPTIVATE_SHOW_ID.
 *
 *   npm run show-id
 */

import { authenticate, getUserShows } from "./captivate.js";

async function main(): Promise<void> {
  const userId = process.env.CAPTIVATE_USER_ID?.trim();
  const apiKey = process.env.CAPTIVATE_API_KEY?.trim();
  if (!userId || !apiKey) {
    throw new Error("Set CAPTIVATE_USER_ID and CAPTIVATE_API_KEY first.");
  }

  const token = await authenticate(userId, apiKey);
  const shows = await getUserShows(token, userId);

  if (!shows.length) {
    console.log("No shows found on this account.");
    return;
  }
  console.log("Your Captivate shows:\n");
  for (const s of shows) {
    console.log(`  ${s.title ?? s.name ?? "(untitled)"}`);
    console.log(`    CAPTIVATE_SHOW_ID=${s.id}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
