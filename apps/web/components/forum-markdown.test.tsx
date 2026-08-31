import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ForumMarkdown, ForumMarkdownEditor } from './forum-markdown';

describe('forum Markdown', () => {
  it('renders GFM and authored line breaks without enabling raw HTML', () => {
    const html = renderToStaticMarkup(
      <ForumMarkdown>{`## Heading
First line
Second line

~~done~~

| A | B |
| - | - |
| 1 | 2 |

<script>alert('no')</script>`}</ForumMarkdown>,
    );

    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('First line<br/>\nSecond line');
    expect(html).toContain('<del>done</del>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<script');
  });

  it('turns remote Markdown images into links instead of loading them', () => {
    const html = renderToStaticMarkup(
      <ForumMarkdown>{`![Diagram](https://example.com/diagram.png)
[Unsafe](javascript:alert(1))
[Protocol relative](//example.com/tracker)`}</ForumMarkdown>,
    );

    expect(html).toContain('href="https://example.com/diagram.png"');
    expect(html).toContain('>Diagram</a>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="//example.com/tracker"');
  });

  it('uses the approved topic and reply editor heights', () => {
    const topic = renderToStaticMarkup(<ForumMarkdownEditor name="topic" />);
    const reply = renderToStaticMarkup(<ForumMarkdownEditor name="reply" size="reply" />);

    expect(topic).toContain('min-h-64');
    expect(reply).toContain('min-h-32');
    expect(topic).toContain('Markdown supported');
  });
});
