import React, { useMemo } from 'react';
import { parseInline, parseMarkdown } from '../../utils/markdown';

// Compact Markdown for chat bubbles (the docs renderer is sized for full pages).
const Inline: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseInline(text).map((p, i) => {
      if (p.t === 'code')
        return (
          <code key={i} className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[0.9em] font-mono text-slate-800 break-words">
            {p.v}
          </code>
        );
      if (p.t === 'bold')
        return (
          <strong key={i} className="font-semibold text-slate-900">
            <Inline text={p.v} />
          </strong>
        );
      if (p.t === 'italic') return <em key={i}>{p.v}</em>;
      if (p.t === 'link')
        return (
          <a key={i} href={p.href} target="_blank" rel="noreferrer" className="text-sky-700 underline break-all">
            {p.v}
          </a>
        );
      return <React.Fragment key={i}>{p.v}</React.Fragment>;
    })}
  </>
);

export const ChatMarkdown: React.FC<{ source: string }> = ({ source }) => {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-700 break-words">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <p key={i} className="font-semibold text-slate-900">
                <Inline text={b.text} />
              </p>
            );
          case 'paragraph':
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case 'quote':
            return (
              <blockquote key={i} className="pl-3 border-l-2 border-slate-300 text-slate-600 whitespace-pre-wrap">
                <Inline text={b.text} />
              </blockquote>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} start={b.ordered ? b.start : undefined} className={`pl-5 space-y-0.5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((item, j) =>
                  item.startsWith('  • ') ? (
                    <li key={j} className="ml-4 list-[circle]">
                      <Inline text={item.slice(4)} />
                    </li>
                  ) : (
                    <li key={j}>
                      <Inline text={item} />
                    </li>
                  ),
                )}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table className="text-xs border border-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} className="px-2 py-1 text-left font-semibold border-b border-slate-200">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-t border-slate-100">
                        {row.map((c, j) => (
                          <td key={j} className="px-2 py-1 align-top">
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre key={i} className="p-2.5 rounded-md bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto">
                {b.code}
              </pre>
            );
          case 'rule':
            return <hr key={i} className="border-slate-200" />;
          default:
            return null;
        }
      })}
    </div>
  );
};
