import { describe, expect, it } from 'vitest';
import { classifyAttachmentRisk } from '../../core/attachment-risk';

describe('classifyAttachmentRisk', () => {
  it('treats ordinary documents as low risk', () => {
    const risk = classifyAttachmentRisk({ filename: 'report.pdf', mimeType: 'application/pdf' });

    expect(risk.level).toBe('low');
  });

  it('flags executable extensions as high risk', () => {
    const risk = classifyAttachmentRisk({ filename: 'invoice.exe', mimeType: 'application/octet-stream' });

    expect(risk.level).toBe('high');
    expect(risk.reason).toBe('executable_extension');
  });

  it('flags double extension tricks as high risk', () => {
    const risk = classifyAttachmentRisk({ filename: 'invoice.pdf.exe', mimeType: 'application/pdf' });

    expect(risk.level).toBe('high');
    expect(risk.reason).toBe('double_extension');
  });

  it('treats unknown binary files as medium risk', () => {
    const risk = classifyAttachmentRisk({ filename: 'archive.bin', mimeType: 'application/octet-stream' });

    expect(risk.level).toBe('medium');
    expect(risk.reason).toBe('unknown_type');
  });
});
