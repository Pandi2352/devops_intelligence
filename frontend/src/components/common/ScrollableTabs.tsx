import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  activeBorderColor?: string;
  activeTextColor?: string;
  activeBgColor?: string;
}

interface ScrollableTabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
}

export function ScrollableTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className = '',
}: ScrollableTabsProps<T>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  // Check scroll position to dynamically show/enable left and right arrows
  const checkScrollability = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth > el.clientWidth + 2;
    setHasOverflow(overflowing);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    checkScrollability();
    const el = scrollContainerRef.current;
    if (!el) return;

    window.addEventListener('resize', checkScrollability);
    return () => window.removeEventListener('resize', checkScrollability);
  }, [checkScrollability, tabs]);

  // Scroll active tab into view if needed
  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
    // Re-check after tab scroll
    const timer = setTimeout(checkScrollability, 250);
    return () => clearTimeout(timer);
  }, [activeTab, checkScrollability]);

  const handleScroll = () => {
    checkScrollability();
  };

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = 180;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
    setTimeout(checkScrollability, 300);
  };

  return (
    <div className={`relative flex items-center border-b border-slate-200 gap-1 ${className}`}>
      {/* Left Scroll Navigation Button (shown when scrollable) */}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          className={`shrink-0 p-1.5 rounded-md border transition-all cursor-pointer ${
            canScrollLeft
              ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-none'
              : 'opacity-30 text-slate-400 border-transparent cursor-not-allowed'
          }`}
          title="Scroll left"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      {/* Tabs Container: NO scrollbar visible at all, smoothly scrollable */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar select-none py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const borderClass = tab.activeBorderColor || 'border-sky-600';
          const textClass = tab.activeTextColor || 'text-sky-700';
          const bgClass = tab.activeBgColor || 'bg-sky-50/40';

          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : null}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 rounded-t-md ${
                isActive
                  ? `${borderClass} ${textClass} ${bgClass}`
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="shrink-0">{tab.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Right Scroll Navigation Button (shown when scrollable) */}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          className={`shrink-0 p-1.5 rounded-md border transition-all cursor-pointer ${
            canScrollRight
              ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-none'
              : 'opacity-30 text-slate-400 border-transparent cursor-not-allowed'
          }`}
          title="Scroll right"
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
