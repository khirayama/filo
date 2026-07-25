const URL_RE = /https?:\/\/[^\s)}\]>]+/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const HTML_TAG_RE = /<[^>]+>/g;
const BRACKET_NOISE_RE =
  /\[(image|photo|img|figure|caption|ad|advertisement|banner|nav|menu|sidebar|footer|header)\]/gi;
const MULTI_WHITESPACE_RE = /[^\S\n]{2,}/g;
const MULTI_NEWLINE_RE = /\n{3,}/g;

export function cleanTextForSpeech(text: string): string {
  let t = text;
  t = t.replace(FENCED_CODE_RE, "");
  t = t.replace(INLINE_CODE_RE, "");
  t = t.replace(HTML_TAG_RE, "");
  t = t.replace(URL_RE, "");
  t = t.replace(EMAIL_RE, "");
  t = t.replace(BRACKET_NOISE_RE, "");
  t = t.replace(MULTI_WHITESPACE_RE, " ");
  t = t.replace(MULTI_NEWLINE_RE, "\n\n");
  return t.trim();
}

const SENTENCE_END_RE = /[。.!?！？]\s*/;
const CLAUSE_RE = /[、,;；]\s*/;

export function splitIntoChunks(text: string, maxLength = 3000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 1 <= maxLength) {
      current += (current ? "\n\n" : "") + trimmed;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (trimmed.length <= maxLength) {
      current = trimmed;
      continue;
    }

    splitLongText(trimmed, maxLength, chunks);
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.trim()];
}

function splitLongText(text: string, maxLength: number, out: string[]): void {
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    let splitAt = findLastMatch(slice, SENTENCE_END_RE);
    if (splitAt < maxLength * 0.3) {
      splitAt = findLastMatch(slice, CLAUSE_RE);
    }
    if (splitAt < maxLength * 0.3) {
      splitAt = slice.lastIndexOf(" ");
    }
    if (splitAt < maxLength * 0.3) {
      splitAt = maxLength;
    }

    out.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) out.push(remaining);
}

function findLastMatch(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, "g");
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    last = m.index + m[0].length;
  }
  return last;
}
