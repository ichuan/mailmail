import { describe, it, expect } from 'vitest';
import { buildToWithContact } from '../ComposeView';
import type { Contact } from '../ComposeView';

const alice: Contact = { name: 'Alice Smith', email: 'alice@example.com' };
const bob: Contact = { name: 'Bob Jones', email: 'bob@example.com' };

describe('buildToWithContact', () => {
  it('replaces empty To field with "Name <email>"', () => {
    expect(buildToWithContact('', alice)).toBe('Alice Smith <alice@example.com>');
  });

  it('replaces a partial token being typed', () => {
    expect(buildToWithContact('alice', alice)).toBe('Alice Smith <alice@example.com>');
  });

  it('appends contact after existing complete address', () => {
    const result = buildToWithContact('someone@test.example.com,bob', bob);
    expect(result).toBe('someone@test.example.com, Bob Jones <bob@example.com>');
  });

  it('handles multiple existing tokens correctly', () => {
    // Input tokens: ["a@x.example.com", " b@x.example.com", " partial"]; last token already has
    // a leading space, so replacement " Alice ..." produces one space in the join.
    const result = buildToWithContact('a@x.example.com, b@x.example.com, partial', alice);
    expect(result).toBe('a@x.example.com, b@x.example.com, Alice Smith <alice@example.com>');
  });

  it('works when contact name equals email (bare address fallback)', () => {
    const bare: Contact = { name: 'bare@example.com', email: 'bare@example.com' };
    expect(buildToWithContact('bare', bare)).toBe('bare@example.com <bare@example.com>');
  });

  it('does not modify earlier tokens in the list', () => {
    const result = buildToWithContact('first@x.example.com, second@x.example.com, typing', alice);
    expect(result.startsWith('first@x.example.com, second@x.example.com,')).toBe(true);
    expect(result).toContain('Alice Smith <alice@example.com>');
  });
});
