// Menu documents: PDFs a site links to instead of publishing its offer as
// HTML. A three-Michelin-star restaurant (tresindstudio.com) kept its food,
// papadom, bar and pairing menus in four PDFs; the crawl read "Food Menu",
// "Wine Menu" and "Pairing Menu" as its offerings and wrote prompts about
// cocktail bars. Only PDFs whose link text or file name says they are a menu,
// brochure, catalogue or price list are fetched, a few per crawl, and their
// text goes through the ordinary page extractor as a "menu" page.

import { extractText } from "unpdf";
import { extractPage, type ExtractedPage } from "./extractor";

const MENU_DOCUMENT = /\b(menus?|papadom|pairing|wine|drinks?|bar|cocktails?|brochure|catalog(?:ue)?|price[- ]?list|pricing|tariffs?|rate[- ]?card|carte|degustation|tasting|dishes|food)\b/i;

/** A same-site PDF the crawl should read: its file name or link text says what it is. */
export function isMenuDocument(url: string, anchorText: string | null | undefined): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!/\.pdf$/i.test(pathname)) return false;
  const file = decodeURIComponent(pathname.split("/").pop() ?? "").replace(/[-_.]+/g, " ");
  return MENU_DOCUMENT.test(file) || MENU_DOCUMENT.test(anchorText ?? "");
}

/** The title a document page gets: the link text when it names the document, else the file name. */
export function documentTitle(url: string, anchorText: string | null | undefined): string {
  const label = (anchorText ?? "").trim();
  if (label.length >= 3 && label.length <= 80) return label;
  try {
    const file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return file.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\.+/g, " ").trim() || "Menu";
  } catch {
    return "Menu";
  }
}

const MAX_DOCUMENT_CHARS = 60_000;

/**
 * Document text as a page: each line a paragraph under an H1, so the page
 * extractor, the evidence builder and the digest treat it like any other
 * menu page. Exported for tests.
 */
export function pageFromDocumentText(text: string, url: string, title: string): ExtractedPage {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, 2_000);
  const body = lines.map((line) => `<p>${escape(line)}</p>`).join("\n").slice(0, MAX_DOCUMENT_CHARS);
  return extractPage(`<html><head><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`, url);
}

/** Text of a PDF, or null when it has none (a scanned image) or cannot be parsed. */
export async function extractDocumentPage(bytes: Uint8Array, url: string, title: string): Promise<ExtractedPage | null> {
  try {
    const { text } = await extractText(bytes, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    if (!merged || merged.replace(/\s+/g, "").length < 80) return null;
    return pageFromDocumentText(merged, url, title);
  } catch {
    return null;
  }
}
