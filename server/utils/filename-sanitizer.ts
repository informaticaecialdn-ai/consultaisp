/**
 * Sanitizes a filename for safe use in Content-Disposition headers.
 * Removes control characters and special characters that could enable header injection.
 */
export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[\r\n\0"\\;]/g, "")
    .trim()
    .slice(0, 200);

  return sanitized || "documento";
}
