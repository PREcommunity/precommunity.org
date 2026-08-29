import { describe, expect, it } from 'vitest';
import { isThemePreference, resolveTheme } from './theme';

describe('theme preferences', () => {
  it('accepts only supported saved preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('night')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('resolves the system preference from the operating system', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
