export type AttachmentRiskLevel = 'low' | 'medium' | 'high';
export type AttachmentRiskReason =
  | 'known_safe_type'
  | 'unknown_type'
  | 'archive_or_office'
  | 'executable_extension'
  | 'double_extension';

export interface AttachmentRisk {
  level: AttachmentRiskLevel;
  reason: AttachmentRiskReason;
}

const EXECUTABLE_EXTENSIONS = new Set([
  'bat',
  'cmd',
  'com',
  'exe',
  'js',
  'msi',
  'ps1',
  'scr',
  'vbs',
  'wsf',
]);

const LOW_RISK_MIME_TYPES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'text/csv',
  'text/plain',
]);

const MEDIUM_RISK_EXTENSIONS = new Set(['7z', 'doc', 'docm', 'docx', 'rar', 'xls', 'xlsm', 'xlsx', 'zip']);

function extensionParts(filename: string): string[] {
  return filename
    .toLowerCase()
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
}

export function classifyAttachmentRisk(input: { filename: string; mimeType: string }): AttachmentRisk {
  const parts = extensionParts(input.filename);
  const extension = parts.at(-1) ?? '';

  if (parts.length >= 3 && EXECUTABLE_EXTENSIONS.has(extension)) {
    return { level: 'high', reason: 'double_extension' };
  }

  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    return { level: 'high', reason: 'executable_extension' };
  }

  if (MEDIUM_RISK_EXTENSIONS.has(extension)) {
    return { level: 'medium', reason: 'archive_or_office' };
  }

  if (LOW_RISK_MIME_TYPES.has(input.mimeType.toLowerCase())) {
    return { level: 'low', reason: 'known_safe_type' };
  }

  return { level: 'medium', reason: 'unknown_type' };
}
