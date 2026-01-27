/**
 * Base64 encode that works in edge runtime (handles UTF-8)
 * Use this instead of Buffer.from() which is not available in Cloudflare Workers
 */
export function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
