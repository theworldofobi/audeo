// Builds SSML for Azure and keeps a map from SSML character offsets back to
// offsets in the plain text, so word-boundary events (which report offsets
// into the SSML) can be placed on the original text.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export interface Ssml {
  ssml: string;
  /** Convert an offset in `ssml` to an offset in the original text (-1 if outside it). */
  toTextOffset(ssmlOffset: number): number;
}

export function buildSsml(text: string, voice: string, lang = voiceLang(voice)): Ssml {
  const prefix =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice.replace(/[^A-Za-z0-9:-]/g, "")}">`;
  const suffix = "</voice></speak>";

  // Strip characters that are invalid in XML 1.0, keep lengths aligned by
  // replacing them with spaces so offsets stay 1:1.
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, " ");

  // starts[i] = SSML offset (relative to body start) of text char i.
  const starts = new Int32Array(clean.length + 1);
  let body = "";
  for (let i = 0; i < clean.length; i++) {
    starts[i] = body.length;
    const ch = clean[i];
    body += ESCAPES[ch] ?? ch;
  }
  starts[clean.length] = body.length;

  const ssml = prefix + body + suffix;
  return {
    ssml,
    toTextOffset(ssmlOffset: number) {
      const rel = ssmlOffset - prefix.length;
      if (rel < 0 || rel > body.length) return -1;
      // binary search the last char whose start <= rel
      let lo = 0;
      let hi = clean.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= rel) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

export function voiceLang(voice: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2})/.exec(voice);
  return m ? m[1] : "en-US";
}
