import { describe, it, expect } from 'vitest';
import { sanitizeEmailHtml, buildIframeSrcDoc } from '../App';

describe('sanitizeEmailHtml', () => {
  it('returns html unchanged when images are allowed', () => {
    const html = '<p>Hello</p><img src="https://example.com/image.jpg" alt="img">';
    expect(sanitizeEmailHtml(html, true)).toBe(html);
  });

  it('strips img tags when images are not allowed', () => {
    const html = '<p>Hello</p><img src="https://tracker.example/pixel.gif">';
    const result = sanitizeEmailHtml(html, false);
    expect(result).not.toContain('<img');
    expect(result).toContain('<p>Hello</p>');
  });

  it('strips self-closing img tags', () => {
    const html = '<p>Hi</p><img src="x.gif" />';
    expect(sanitizeEmailHtml(html, false)).not.toContain('<img');
  });

  it('strips multiple img tags', () => {
    const html = '<img src="a.png"><p>text</p><img src="b.png" alt="B">';
    const result = sanitizeEmailHtml(html, false);
    expect(result).not.toContain('<img');
    expect(result).toContain('<p>text</p>');
  });

  it('returns empty string unchanged', () => {
    expect(sanitizeEmailHtml('', false)).toBe('');
    expect(sanitizeEmailHtml('', true)).toBe('');
  });
});

describe('buildIframeSrcDoc', () => {
  it('wraps html in a full document', () => {
    const doc = buildIframeSrcDoc('<p>test</p>', false);
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('<html>');
    expect(doc).toContain('<body>');
    expect(doc).toContain('<p>test</p>');
    expect(doc).toContain('</body></html>');
  });

  it('includes a style block', () => {
    const doc = buildIframeSrcDoc('<p>hi</p>', false);
    expect(doc).toContain('<style>');
  });

  it('uses dark text color in dark mode', () => {
    const darkDoc = buildIframeSrcDoc('<p>hi</p>', true);
    // Dark mode body text is #e8eaed
    expect(darkDoc).toContain('#e8eaed');
  });

  it('uses light text color in light mode', () => {
    const lightDoc = buildIframeSrcDoc('<p>hi</p>', false);
    // Light mode body text is #1a1a1a
    expect(lightDoc).toContain('#1a1a1a');
  });

  it('includes charset meta tag', () => {
    const doc = buildIframeSrcDoc('<p>hi</p>', false);
    expect(doc).toContain('charset="utf-8"');
  });

  it('does not include script tags in base template', () => {
    const doc = buildIframeSrcDoc('<p>hi</p>', false);
    // The template itself must not inject any scripts
    expect(doc).not.toContain('<script');
  });
});
