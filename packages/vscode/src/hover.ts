// docs/ide-bridge.md describes the hover payload: a markdown image with a data URI first, then the text.

/** HTML is allowed for an `<img>` with a size; command links stay untrusted. */
export const MARKDOWN = { isTrusted: false, supportHtml: true } as const;

/** VS Code cuts the markdown of a hover at this many characters; the server keeps its previews below it. */
export const HOVER_LIMIT = 100000;

const IMAGE = /^!\[([^\]]*)\]\((data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/=]+)\)/;

/** The preview image a pcbjs hover starts with, or undefined. */
export function hoverImage(markdown: string): { alt: string; uri: string; type: 'svg' | 'png' } | undefined {
  const m = IMAGE.exec(markdown);
  return m ? { alt: m[1], uri: m[2], type: m[2].startsWith('data:image/png') ? 'png' : 'svg' } : undefined;
}
