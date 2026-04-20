import { describe, it, expect } from 'vitest';
import { SHORTCUTS } from '../components/ShortcutsPanel';

// ShortcutsPanel is a React component that wraps a plain SHORTCUTS data array.
// We test the data contract without rendering (avoiding the need to mock
// Tauri APIs, CSS variables, and i18n at the DOM level).

describe('SHORTCUTS data', () => {
  it('contains at least 8 shortcuts', () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(8);
  });

  it('every entry has a non-empty key and descriptionKey', () => {
    for (const s of SHORTCUTS) {
      expect(s.key.trim()).not.toBe('');
      expect(s.descriptionKey.trim()).not.toBe('');
    }
  });

  it('includes the essential shortcuts: n, r, d, ?', () => {
    const keys = SHORTCUTS.map(s => s.key);
    expect(keys).toContain('n');
    expect(keys).toContain('r');
    expect(keys).toContain('d / Del');
    expect(keys).toContain('?');
  });

  it('all descriptionKeys use the shortcuts. namespace', () => {
    for (const s of SHORTCUTS) {
      expect(s.descriptionKey).toMatch(/^shortcuts\./);
    }
  });

  it('has no duplicate keys', () => {
    const keys = SHORTCUTS.map(s => s.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});
