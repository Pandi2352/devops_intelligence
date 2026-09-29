import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';

export interface DropdownOption<T = string> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface DropdownProps<T = string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Visible label rendered above the trigger. For FormField-managed labels pass `id` instead. */
  label?: string;
  /** Applied to the trigger so an external <label htmlFor> can point at it. */
  id?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  invalid?: boolean;
  align?: 'left' | 'right';
  /** xs = 28px (pagination), sm = 32px toolbar controls, md = matches TextInput in forms. */
  size?: 'xs' | 'sm' | 'md';
  /** Stretch the trigger to its container. */
  fullWidth?: boolean;
  /** Monospace labels (names, namespaces, branches). */
  mono?: boolean;
  /** Show a filter box; defaults to on when there are more than 8 options. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Minimum menu width in px (the menu is never narrower than the trigger). */
  menuMinWidth?: number;
}

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 6;

const sizeClass = {
  xs: 'h-7 px-2 text-xs',
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
};

export function Dropdown<T = string>({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  label,
  id,
  ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  disabled = false,
  invalid = false,
  align = 'left',
  size = 'sm',
  fullWidth = false,
  mono = false,
  searchable,
  searchPlaceholder = 'Filter…',
  menuMinWidth = 200,
}: DropdownProps<T>) {
  const generatedId = useId();
  const triggerId = id || `dropdown-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isSearchable = searchable ?? options.length > 8;
  const selectedOption = options.find((opt) => opt.value === value);

  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => `${o.label} ${o.sublabel || ''}`.toLowerCase().includes(needle));
  }, [options, query]);

  // The menu is portalled to <body> with fixed positioning so it is never clipped by
  // scrolling modal bodies or table containers. It flips upward when there is no room below.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, menuMinWidth);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_MAX_HEIGHT + MENU_GAP && rect.top > spaceBelow;
    let left = align === 'right' ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPosition({ top: openUp ? rect.top - MENU_GAP : rect.bottom + MENU_GAP, left, width, openUp });
  }, [align, menuMinWidth]);

  const open = () => {
    if (disabled) return;
    const selectedIdx = options.findIndex((o) => o.value === value);
    setQuery('');
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : options.findIndex((o) => !o.disabled));
    updatePosition();
    setIsOpen(true);
  };

  const close = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const handleSelect = (option: DropdownOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', handleOutside);
    (isSearchable ? searchRef.current : listRef.current)?.focus();
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen, isSearchable]);

  // Keep the keyboard-highlighted option in view.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const moveActive = (direction: 1 | -1) => {
    if (visibleOptions.length === 0) return;
    let next = activeIndex;
    for (let i = 0; i < visibleOptions.length; i++) {
      next = (next + direction + visibleOptions.length) % visibleOptions.length;
      if (!visibleOptions[next].disabled) break;
    }
    setActiveIndex(next);
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        if (!isSearchable) {
          e.preventDefault();
          setActiveIndex(visibleOptions.findIndex((o) => !o.disabled));
        }
        break;
      case 'End':
        if (!isSearchable) {
          e.preventDefault();
          const lastEnabled = [...visibleOptions].reverse().findIndex((o) => !o.disabled);
          setActiveIndex(lastEnabled < 0 ? -1 : visibleOptions.length - 1 - lastEnabled);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (visibleOptions[activeIndex]) handleSelect(visibleOptions[activeIndex]);
        break;
      case 'Escape':
        // preventDefault + stopPropagation so an enclosing Modal does not also close.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      if (!isOpen) open();
    }
  };

  const activeOptionId = activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  const menu =
    isOpen && position
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: position.left,
              width: position.width,
              ...(position.openUp ? { bottom: window.innerHeight - position.top } : { top: position.top }),
            }}
            className={`z-[65] bg-white border border-slate-200 rounded-md shadow-lg shadow-slate-900/5 p-1 ${menuClassName}`}
            onKeyDown={handleMenuKeyDown}
          >
            {isSearchable && (
              <div className="relative mb-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listboxId}
                  aria-activedescendant={activeOptionId}
                  role="combobox"
                  aria-expanded="true"
                  className="w-full h-8 pl-7 pr-2 rounded border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:bg-white"
                />
              </div>
            )}
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={triggerId}
              aria-activedescendant={isSearchable ? undefined : activeOptionId}
              style={{ maxHeight: MENU_MAX_HEIGHT - (isSearchable ? 40 : 0) }}
              className="overflow-y-auto custom-scrollbar space-y-0.5 focus:outline-none"
            >
              {visibleOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400 text-center">
                  {query ? 'No matches' : 'No options available'}
                </div>
              ) : (
                visibleOptions.map((option, idx) => {
                  const isSelected = option.value === value;
                  const isActive = idx === activeIndex;
                  return (
                    <div
                      key={`${String(option.value)}-${idx}`}
                      id={`${listboxId}-opt-${idx}`}
                      data-index={idx}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onMouseEnter={() => !option.disabled && setActiveIndex(idx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelect(option)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded text-xs select-none ${
                        option.disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : `cursor-pointer ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700'}`
                      } ${isSelected ? 'text-sky-900 font-semibold' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {option.icon && <span className="shrink-0">{option.icon}</span>}
                        <div className="min-w-0">
                          <div className={`truncate ${mono ? 'font-mono' : ''}`}>{option.label}</div>
                          {option.sublabel && <div className="text-[10px] text-slate-500 font-normal truncate">{option.sublabel}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {option.badge}
                        {isSelected && <Check size={14} className="text-sky-600" aria-hidden />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'block w-full' : 'inline-block'} ${className}`}>
      {label && (
        <label htmlFor={triggerId} className="block text-[11px] font-semibold text-slate-700 mb-1">
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={`flex w-full items-center justify-between gap-2 bg-white border rounded-md font-medium text-slate-800 transition-colors cursor-pointer select-none focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 ${
          sizeClass[size]
        } ${
          invalid
            ? 'border-rose-400 focus-visible:ring-rose-100'
            : isOpen
            ? 'border-sky-500 ring-2 ring-sky-100'
            : 'border-slate-300 hover:border-slate-400 focus-visible:border-sky-500 focus-visible:ring-sky-100'
        } ${buttonClassName}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className={`truncate ${mono ? 'font-mono' : ''} ${selectedOption ? '' : 'text-slate-400'}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && <span className="shrink-0">{selectedOption.badge}</span>}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-sky-600' : ''}`}
        />
      </button>

      {menu}
    </div>
  );
}
