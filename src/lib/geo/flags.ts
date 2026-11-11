// Country flags for the intake picker.
//
// A flag is two regional-indicator code points, so it needs no image and no
// dependency. Windows ships no flag glyphs (Chrome and Edge there render the
// two letters), so the picker checks once whether the platform draws flags and
// otherwise shows the ISO code in a small chip; a flag is never the only
// identification of a country. Client-safe and pure.

/** "AE" → "🇦🇪"; null for anything that is not a two-letter code. */
export function flagEmoji(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  const upper = code.toUpperCase();
  return String.fromCodePoint(...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

let supportsFlags: boolean | null = null;

/**
 * Whether the browser draws regional-indicator pairs as one flag glyph.
 * Draws the UAE flag on a canvas and checks that it is one coloured glyph
 * rather than two letters; the result is cached for the page. Assumes true
 * when it cannot check (server render, no canvas).
 */
export function browserDrawsFlags(): boolean {
  if (supportsFlags !== null) return supportsFlags;
  if (typeof document === "undefined") return true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return (supportsFlags = true);
    context.font = "24px sans-serif";
    context.textBaseline = "top";
    context.fillText("🇦🇪", 0, 0);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    // Letters render as one flat colour; a flag has several. A platform that
    // draws the letters typically also draws them wider than one glyph.
    const colours = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! > 0) colours.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
      if (colours.size > 8) break;
    }
    const width = context.measureText("🇦🇪").width;
    supportsFlags = colours.size > 8 && width < 40;
  } catch {
    supportsFlags = true;
  }
  return supportsFlags;
}
