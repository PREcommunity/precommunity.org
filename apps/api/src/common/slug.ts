import { randomBytes } from 'node:crypto';

export function createSlug(value: string, fallback: string) {
  const base =
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72) || fallback;
  return `${base}-${randomBytes(3).toString('hex')}`;
}
