// Minimal Markdown parser for KubeOrbit's own docs (headings, paragraphs, lists, tables,
// code fences, blockquotes, rules). Inline formatting is handled by the renderer.

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'rule' };

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    // split on | that is not escaped (\|)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export const parseMarkdown = (source: string): Block[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  let i = 0;

  const uniqueId = (text: string) => {
    const base = slugify(text) || 'section';
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fences may be indented (a code block inside a list item); that indent is stripped from the code.
    const fence = /^(\s*)```(\w*)/.exec(line);
    if (fence) {
      const indent = fence[1].length;
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i].slice(Math.min(indent, lines[i].length - lines[i].trimStart().length)));
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang: fence[2], code: code.join('\n') });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, text, id: uniqueId(text) });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quote.join('\n') });
      continue;
    }

    const bullet = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[2]);
      const start = ordered ? parseInt(bullet[2], 10) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) {
          // nested items are flattened with a marker the renderer indents
          items.push(m[1].length >= 2 ? `  • ${m[3]}` : m[3]);
          i += 1;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*```/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`; // wrapped continuation line
          i += 1;
        } else break;
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*```|>|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
};

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'link'; v: string; href: string };

// `code`, **bold**, *italic*, [text](url) and bare http(s) URLs.
export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(https?:\/\/[^\s)|]+)|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    const s = m[0];
    if (m[1]) out.push({ t: 'code', v: s.slice(1, -1) });
    else if (m[2]) out.push({ t: 'bold', v: s.slice(2, -2) });
    else if (m[3]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s)!;
      out.push({ t: 'link', v: lm[1], href: lm[2] });
    } else if (m[4]) out.push({ t: 'link', v: s, href: s });
    else out.push({ t: 'italic', v: s.slice(1, -1) });
    last = m.index + s.length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
};
