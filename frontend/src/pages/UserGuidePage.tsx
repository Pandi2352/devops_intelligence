import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, BookOpen, Download, ListChecks, Search } from 'lucide-react';
import { MarkdownView } from '../components/docs/MarkdownView';
import { parseMarkdown } from '../utils/markdown';
import guideSource from '../../../docs/DEVOPS_INTELLIGENCE_USER_GUIDE.md?raw';

// Renders docs/DEVOPS_INTELLIGENCE_USER_GUIDE.md, the single source for the user guide.
export const UserGuidePage: React.FC = () => {
  const blocks = useMemo(() => parseMarkdown(guideSource), []);
  const toc = useMemo(() => blocks.filter((b) => b.type === 'heading' && (b.level === 2 || b.level === 3)) as Extract<(typeof blocks)[number], { type: 'heading' }>[], [blocks]);
  const [active, setActive] = useState(toc[0]?.id || '');
  const [filter, setFilter] = useState('');
  const topRef = useRef<HTMLDivElement>(null);

  // Highlight the section being read.
  useEffect(() => {
    const els = toc.map((h) => document.getElementById(h.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px' }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  // Deep links: /guide#part-d-run-and-debug-day-2-operations
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  const shown = toc.filter((h) => !filter || h.text.toLowerCase().includes(filter.toLowerCase()));
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([guideSource], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DEVOPS_INTELLIGENCE_USER_GUIDE.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-8 items-start">
      <aside className="hidden lg:block sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2 px-1 mb-2">
          <BookOpen size={15} className="text-sky-600" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">User guide</span>
        </div>
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2 top-2 text-slate-400" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sections"
            aria-label="Filter sections"
            className="w-full pl-6 pr-2 py-1 text-[11px] rounded-md border border-slate-200 focus:outline-none focus:border-sky-500"
          />
        </div>
        <nav aria-label="Table of contents">
          <ul className="space-y-0.5">
            {shown.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => jump(h.id)}
                  className={`w-full text-left rounded-md px-2 py-1 text-[12px] leading-snug transition-colors ${h.level === 3 ? 'pl-5 text-[11.5px]' : 'font-semibold'} ${
                    active === h.id ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {h.text.replace(/`/g, '')}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 max-w-4xl" ref={topRef}>
        <div className="flex flex-wrap items-center justify-end gap-2 mb-2">
          <Link to="/docs" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <ListChecks size={13} /> Setup checklist
          </Link>
          <button type="button" onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Download size={13} /> Download .md
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-6 sm:px-10 py-8">
          <MarkdownView blocks={blocks} />
        </div>
        <button
          type="button"
          onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="mt-4 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-sky-700"
        >
          <ArrowUp size={12} /> Back to top
        </button>
      </div>
    </div>
  );
};
