/**
 * Accept only absolute http(s) URLs.
 *
 * Applied to every URL that arrives from outside the app and later reaches an
 * `<Image source={{ uri }}>` or `Linking.openURL`: imported JSON-LD and og tags,
 * Instagram canonical URLs, the shared meal catalog mirror, and rows pulled by
 * sync. Total and non-throwing, so a malformed value degrades to "no URL" rather
 * than to an exception in a row mapper.
 */
export function sanitizeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch {
    // not an absolute URL
  }
  return undefined;
}
