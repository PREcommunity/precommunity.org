'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { type ThemePreference, useTheme } from './theme-provider';
import { HEADER_OVERLAY_EVENT, openHeaderOverlay } from './header-overlay';

const options: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

export function ThemeSwitcher() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'theme') setOpen(false);
    };
    window.addEventListener(HEADER_OVERLAY_EVENT, close);
    return () => window.removeEventListener(HEADER_OVERLAY_EVENT, close);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) openHeaderOverlay('theme');
  }

  return (
    <div className="relative" ref={root}>
      <button
        className="grid size-9 cursor-pointer place-items-center rounded-full border border-navy bg-transparent text-navy transition-colors duration-150 hover:border-blue hover:bg-blue-soft aria-expanded:border-blue aria-expanded:bg-blue-soft dark:border-current"
        type="button"
        aria-label="Choose color theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <TriggerIcon size={17} />
      </button>
      {open ? (
        <div
          className="absolute top-full right-0 z-50 mt-2 w-36 border border-line bg-paper p-1 shadow-lg"
          role="menu"
          aria-label="Color theme"
        >
          {options.map(({ value, label, Icon }) => (
            <button
              className={`flex w-full items-center gap-2 px-2 py-2 text-left text-xs transition-colors hover:bg-blue-soft ${preference === value ? 'bg-blue-soft text-navy' : 'text-muted'}`}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              key={value}
              onClick={() => {
                setPreference(value);
                setOpen(false);
              }}
            >
              <Icon size={15} />
              {label}
              {preference === value ? <Check className="ml-auto" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
