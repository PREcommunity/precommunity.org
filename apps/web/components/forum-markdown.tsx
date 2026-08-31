'use client';

import React, { useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

function safeMarkdownUrl(value: string) {
  if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return value;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? value : '';
  } catch {
    return '';
  }
}

export function ForumMarkdown({ children }: { children: string }) {
  return (
    <div className="forum-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
          img: ({ src, alt }) => {
            const href = typeof src === 'string' ? safeMarkdownUrl(src) : '';
            return href ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {alt || 'Image link'}
              </a>
            ) : (
              <span>{alt || 'Image link'}</span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

type ForumMarkdownEditorProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'defaultValue' | 'value'
> & {
  defaultValue?: string;
  size?: 'topic' | 'reply';
};

export function ForumMarkdownEditor({
  defaultValue = '',
  size = 'topic',
  className = '',
  onChange,
  onInvalid,
  ...props
}: ForumMarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [value, setValue] = useState(defaultValue);
  const heightClass = size === 'topic' ? 'min-h-64' : 'min-h-32';

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    setValue(event.currentTarget.value);
    onChange?.(event);
  }

  return (
    <div className="overflow-hidden rounded-[3px] border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line bg-blue-soft px-2 py-1.5">
        <span className="flex gap-1" role="tablist" aria-label="Markdown editor mode">
          {(['write', 'preview'] as const).map((tab) => (
            <button
              className={`min-h-8 rounded px-2 text-[10px] font-bold capitalize ${mode === tab ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}
              type="button"
              role="tab"
              aria-selected={mode === tab}
              onClick={() => setMode(tab)}
              key={tab}
            >
              {tab}
            </button>
          ))}
        </span>
        <span className="text-[9px] text-muted">Markdown supported</span>
      </div>
      <textarea
        {...props}
        className={`${heightClass} w-full resize-y border-0 bg-transparent px-3 py-2.5 text-navy outline-none ${mode === 'preview' ? 'sr-only' : ''} ${className}`}
        value={value}
        onChange={change}
        onInvalid={(event) => {
          setMode('write');
          onInvalid?.(event);
        }}
      />
      {mode === 'preview' ? (
        <div className={`${heightClass} px-3 py-2.5`} role="tabpanel">
          {value.trim() ? (
            <ForumMarkdown>{value}</ForumMarkdown>
          ) : (
            <p className="m-0 text-muted">Nothing to preview yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
