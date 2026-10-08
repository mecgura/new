/**
 * Rules every future upload endpoint (reports, documents, logos) MUST apply server-side.
 * Phase 0 ships the rules + validator only — there is no upload endpoint or storage yet.
 *  - allow-list by MIME type AND extension; never trust the client-supplied type alone
 *  - hard size cap; store outside the web root / in private object storage
 *  - random storage key (never the original filename); keep original name as metadata only
 *  - serve through an authenticated, tenant-checked route with Content-Disposition + nosniff
 *  - audit every upload and download (AUDIT_ACTIONS.REPORT_UPLOADED / DOCUMENT_DOWNLOADED)
 */
export const UPLOAD_POLICIES = {
  medicalDocument: { maxBytes: 15 * 1024 * 1024, types: { "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] } },
  brandingImage: { maxBytes: 2 * 1024 * 1024, types: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] } },
} as const;

export type UploadPolicyName = keyof typeof UPLOAD_POLICIES;

export function validateUpload(policy: UploadPolicyName, file: { name: string; type: string; size: number }): string | null {
  const p = UPLOAD_POLICIES[policy];
  if (file.size <= 0) return "The file is empty.";
  if (file.size > p.maxBytes) return `File is larger than ${Math.round(p.maxBytes / 1024 / 1024)} MB.`;
  const exts = (p.types as Record<string, readonly string[]>)[file.type];
  const name = file.name.toLowerCase();
  if (!exts || !exts.some((e) => name.endsWith(e))) return "This file type isn't allowed.";
  return null;
}
