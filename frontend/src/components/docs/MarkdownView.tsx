import React, { useState } from 'react';
import { Check, Copy, Info, Link2 } from 'lucide-react';
import { Block, parseInline } from '../../utils/markdown';

const InlineText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseInline(text).map((p, i) => {
      if (p.t === 'code')
        return (
          <code key={i} className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[0.85em] font-mono text-slate-800 break-words">
            {p.v}
          </code>
        );
      if (p.t === 'bold')
        return (
          <strong key={i} className="font-semibold text-slate-900">
            <InlineText text={p.v} />
          </strong>
        );
      if (p.t === 'italic')
        return (
          <em key={i} className="italic">
            {p.v}
          </em>
        );
      if (p.t === 'link') {
        const external = /^https?:/.test(p.href);
        return (
          <a key={i} href={p.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className="text-sky-700 underline decoration-sky-300 hover:decoration-sky-600 break-all">
            {p.v}
          </a>
        );
      }
      return <React.Fragment key={i}>{p.v}</React.Fragment>;
    })}
  </>
);

const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);
  const diagram = !lang && /[│─┌└▶▼]/.test(code);
  return (
    <div className="my-4 rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">{lang || (diagram ? 'diagram' : 'text')}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`p-4 overflow-x-auto text-[12.5px] leading-relaxed font-mono ${diagram ? 'text-sky-200' : 'text-slate-100'}`}>{code}</pre>
    </div>
  );
};

const HEADING_CLASS = {
  1: 'text-3xl font-bold text-slate-900 tracking-tight mt-2 mb-3',
  2: 'text-xl font-bold text-slate-900 mt-12 mb-3 pb-2 border-b border-slate-200 scroll-mt-20',
  3: 'text-base font-semibold text-slate-900 mt-8 mb-2 scroll-mt-20',
  4: 'text-sm font-semibold text-slate-800 mt-6 mb-2 scroll-mt-20',
};

export const MarkdownView: React.FC<{ blocks: Block[] }> = ({ blocks }) => (
  <article className="text-[14px] leading-7 text-slate-700">
    {blocks.map((b, i) => {
      switch (b.type) {
        case 'heading': {
          const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3' | 'h4';
          return (
            <Tag key={i} id={b.id} className={`group ${HEADING_CLASS[b.level]}`}>
              <InlineText text={b.text} />
              {b.level > 1 && (
                <a href={`#${b.id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 align-middle" aria-label={`Link to ${b.text}`}>
                  <Link2 size={14} className="inline" />
                </a>
              )}
            </Tag>
          );
        }
        case 'paragraph':
          return (
            <p key={i} className="my-3">
              <InlineText text={b.text} />
            </p>
          );
        case 'quote':
          return (
            <div key={i} className="my-4 flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-[13.5px] text-sky-950">
              <Info size={16} className="shrink-0 mt-1 text-sky-600" aria-hidden />
              <div className="space-y-1">
                {b.text.split('\n').map((l, j) => (
                  <p key={j}>
                    <InlineText text={l} />
                  </p>
                ))}
              </div>
            </div>
          );
        case 'list': {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} {...(b.ordered && b.start > 1 ? { start: b.start } : {})} className={`my-3 space-y-1.5 pl-6 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
              {b.items.map((item, j) => {
                const nested = item.startsWith('  • ');
                return (
                  <li key={j} className={nested ? 'list-none -ml-1 pl-4 text-[13.5px]' : ''}>
                    <InlineText text={nested ? `◦ ${item.slice(4)}` : item} />
                  </li>
                );
              })}
            </Tag>
          );
        }
        case 'table':
          return (
            <div key={i} className="my-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-[13px] border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j} className="text-left font-semibold text-slate-700 px-3 py-2 border-b border-slate-200 whitespace-nowrap">
                        <InlineText text={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.rows.map((r, j) => (
                    <tr key={j} className="hover:bg-slate-50/60 align-top">
                      {r.map((c, k) => (
                        <td key={k} className={`px-3 py-2 ${k === 0 ? 'font-medium text-slate-800' : ''}`}>
                          <InlineText text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case 'code':
          return <CodeBlock key={i} lang={b.lang} code={b.code} />;
        case 'rule':
          return <hr key={i} className="my-8 border-slate-200" />;
        default:
          return null;
      }
    })}
  </article>
);
