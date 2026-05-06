import { describe, expect, it } from 'vitest';
import { displayPath } from '../SettingsView';

describe('displayPath', () => {
  it('hides Windows verbatim drive path prefixes', () => {
    expect(displayPath('\\\\?\\D:\\data\\mailmail')).toBe('D:\\data\\mailmail');
  });

  it('hides Windows verbatim UNC path prefixes', () => {
    expect(displayPath('\\\\?\\UNC\\server\\share\\mailmail')).toBe('\\\\server\\share\\mailmail');
  });

  it('leaves normal paths unchanged', () => {
    expect(displayPath('D:\\data\\mailmail')).toBe('D:\\data\\mailmail');
  });
});
