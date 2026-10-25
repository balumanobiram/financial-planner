const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Light client-side check for a bank website ("hdfcbank.com", "https://www.icicibank.com/cards").
 * The backend does the real clean-up (strips https://, www., paths) and has the final say.
 */
export function looksLikeDomain(raw: string): boolean {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return DOMAIN_RE.test(host);
}
