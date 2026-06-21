/**
 * Convert a Notion page's body blocks into HTML show notes for Captivate.
 *
 * Supports the common authoring blocks: paragraphs, H1-H3, bulleted/numbered
 * lists, quotes, and dividers, with inline bold / italic / links. Anything else
 * is rendered as plain paragraph text so nothing is silently dropped.
 */

import type { Client } from "@notionhq/client";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Notion rich_text array -> inline HTML. */
function richToHtml(rich: any[] | undefined): string {
  if (!rich || rich.length === 0) return "";
  return rich
    .map((t) => {
      let text = escapeHtml(t.plain_text ?? "");
      const a = t.annotations ?? {};
      if (a.code) text = `<code>${text}</code>`;
      if (a.bold) text = `<strong>${text}</strong>`;
      if (a.italic) text = `<em>${text}</em>`;
      if (a.strikethrough) text = `<s>${text}</s>`;
      const href = t.href;
      if (href) text = `<a href="${escapeHtml(href)}">${text}</a>`;
      return text;
    })
    .join("");
}

async function fetchAllBlocks(notion: Client, blockId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return blocks;
}

/**
 * Build HTML show notes from a Notion page body. Returns "" if the page has no
 * usable content (caller can fall back to the Summary property).
 */
export async function pageToShowNotesHtml(notion: Client, pageId: string): Promise<string> {
  const blocks = await fetchAllBlocks(notion, pageId);
  const html: string[] = [];

  // Collapse consecutive list items into a single <ul>/<ol>.
  let listType: "ul" | "ol" | null = null;
  const items: string[] = [];
  const flushList = () => {
    if (listType && items.length) {
      html.push(`<${listType}>${items.map((i) => `<li>${i}</li>`).join("")}</${listType}>`);
    }
    listType = null;
    items.length = 0;
  };

  for (const block of blocks as any[]) {
    const type = block.type;
    const data = block[type];

    if (type === "bulleted_list_item" || type === "numbered_list_item") {
      const want = type === "bulleted_list_item" ? "ul" : "ol";
      if (listType !== want) flushList();
      listType = want;
      items.push(richToHtml(data.rich_text));
      continue;
    }
    flushList();

    switch (type) {
      case "paragraph": {
        const inner = richToHtml(data.rich_text);
        if (inner) html.push(`<p>${inner}</p>`);
        break;
      }
      case "heading_1":
        html.push(`<h2>${richToHtml(data.rich_text)}</h2>`); // demote: H1 reserved for title
        break;
      case "heading_2":
        html.push(`<h3>${richToHtml(data.rich_text)}</h3>`);
        break;
      case "heading_3":
        html.push(`<h4>${richToHtml(data.rich_text)}</h4>`);
        break;
      case "quote":
        html.push(`<blockquote>${richToHtml(data.rich_text)}</blockquote>`);
        break;
      case "divider":
        html.push("<hr>");
        break;
      case "callout":
        html.push(`<p>${richToHtml(data.rich_text)}</p>`);
        break;
      default: {
        // Unknown block: emit its text if it has any, otherwise skip.
        const inner = richToHtml(data?.rich_text);
        if (inner) html.push(`<p>${inner}</p>`);
      }
    }
  }
  flushList();

  return html.join("\n");
}
