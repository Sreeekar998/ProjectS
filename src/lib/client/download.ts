// Saving a server-produced file from the browser.
//
// The export links used to be plain navigations to the export route. When the
// route answered with an error (a stale run id after "Collect again", a
// computation failure on a live run) the browser navigated to the JSON error
// body and the Measure workspace was gone: scope, filters, drawers and scroll
// position with it. Fetching first keeps the page, lets the caller show the
// error in place, and still hands the bytes to the browser's own download.

export class DownloadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]!.trim()) : fallback;
}

/** Fetches `url` and saves the response as a file; throws DownloadError (with the server's message) on failure. */
export async function downloadFile(url: string, fallbackName: string): Promise<string> {
  const res = await fetch(url, { headers: { accept: "text/csv, application/json, */*" } });
  if (!res.ok) {
    let message = `The export could not be produced (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // A non-JSON error body: keep the generic message.
    }
    throw new DownloadError(res.status, message);
  }
  const blob = await res.blob();
  const name = filenameFrom(res.headers.get("content-disposition"), fallbackName);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked after the click has been handed to the browser; revoking synchronously cancels the save in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}
