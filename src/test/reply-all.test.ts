import { describe, it, expect } from 'vitest';
import { extractEmailAddr } from '../App';

describe('extractEmailAddr', () => {
  it('returns plain address unchanged (lowercased)', () => {
    expect(extractEmailAddr('user@example.com')).toBe('user@example.com');
  });

  it('extracts address from "Display Name <email>" format', () => {
    expect(extractEmailAddr('Alice Smith <alice@example.com>')).toBe('alice@example.com');
  });

  it('handles angle brackets with only an address inside', () => {
    expect(extractEmailAddr('<bob@example.com>')).toBe('bob@example.com');
  });

  it('normalizes to lowercase', () => {
    expect(extractEmailAddr('Alice <ALICE@Example.COM>')).toBe('alice@example.com');
    expect(extractEmailAddr('BOB@EXAMPLE.COM')).toBe('bob@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(extractEmailAddr('  user@example.com  ')).toBe('user@example.com');
    expect(extractEmailAddr('  Alice <alice@example.com>  ')).toBe('alice@example.com');
  });

  it('handles quoted display names with angle brackets', () => {
    expect(extractEmailAddr('"Doe, Jane" <jane@example.com>')).toBe('jane@example.com');
  });
});

describe('Reply All deduplication logic', () => {
  // Simulate the Set-based dedup used in handleReplyAll
  function buildToList(
    senderEmail: string,
    recipientHeader: string,
    ownEmail: string,
  ): string {
    const rawAddrs = [
      senderEmail,
      ...recipientHeader.split(',').map(s => s.trim()).filter(Boolean),
    ];
    const seen = new Set<string>();
    return rawAddrs
      .filter(addr => {
        if (!addr) return false;
        const normalized = extractEmailAddr(addr);
        if (normalized === ownEmail.toLowerCase() || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join(', ');
  }

  it('excludes own email from reply-all list', () => {
    const result = buildToList('sender@a.com', 'me@own.com, other@b.com', 'me@own.com');
    expect(result).not.toContain('me@own.com');
    expect(result).toContain('sender@a.com');
    expect(result).toContain('other@b.com');
  });

  it('deduplicates exact duplicate addresses', () => {
    const result = buildToList('alice@a.com', 'alice@a.com, bob@b.com', 'me@own.com');
    expect(result.split(', ').filter(a => a === 'alice@a.com').length).toBe(1);
  });

  it('deduplicates "Name <email>" and plain email pointing to same address', () => {
    // senderEmail is bare address; recipient header has "Name <address>" form
    const result = buildToList('alice@a.com', 'Alice Smith <alice@a.com>, bob@b.com', 'me@own.com');
    const addrs = result.split(', ');
    // Only one entry for alice@a.com (in either form)
    const aliceCount = addrs.filter(a => extractEmailAddr(a) === 'alice@a.com').length;
    expect(aliceCount).toBe(1);
    expect(result).toContain('bob@b.com');
  });

  it('excludes own email when it arrives as "Name <own>" in recipient header', () => {
    const result = buildToList('sender@a.com', 'Me Myself <me@own.com>', 'me@own.com');
    expect(result).not.toContain('me@own.com');
    expect(result).toContain('sender@a.com');
  });

  it('handles empty recipient header gracefully', () => {
    const result = buildToList('sender@a.com', '', 'me@own.com');
    expect(result).toBe('sender@a.com');
  });
});
