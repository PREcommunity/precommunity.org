import type { GoalDocument } from '@precommunity/shared';

export function isPositiveAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value);
}

export function parseDocuments(value: string): GoalDocument[] {
  return value
    .split('\n')
    .map((line) => {
      const [label = '', url = ''] = line.split('|');
      return { label: label.trim(), url: url.trim() };
    })
    .filter((document) => document.label && /^https?:\/\//.test(document.url));
}
