/**
 * Cleans a URL by removing whitespace, markdown bullet points, list items,
 * and surrounding quotes (single and double).
 */
export function cleanUrl(url: string | undefined | null): string {
    if (!url) return '';
    let cleaned = url.trim();
    // Remove markdown list markers and quotes: e.g. * "link" or - 'link' or just "link"
    cleaned = cleaned.replace(/^[*\-+\s'"]+/, '').replace(/['"]+$/, '').trim();
    return cleaned;
}

/**
 * Validates whether a given string is a valid web URL.
 * Rejects local paths, strings with spaces, and formats that don't match typical URL patterns.
 */
export function isValidUrl(url: string | undefined | null): boolean {
    const cleaned = cleanUrl(url);
    if (!cleaned) return false;

    // Quick structural checks
    if (cleaned.includes(' ') || !cleaned.includes('.') || cleaned.startsWith('/') || cleaned.startsWith('\\')) {
        return false;
    }

    try {
        const urlToTest = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
        new URL(urlToTest);
        return true;
    } catch {
        return false;
    }
}

/**
 * Ensures that the URL has an absolute protocol prefix (https:// or http://).
 * Sanitizes the URL first.
 */
export function ensureAbsoluteUrl(url: string | undefined | null): string {
    const cleaned = cleanUrl(url);
    if (!cleaned) return '';
    if (/^https?:\/\//i.test(cleaned)) {
        return cleaned;
    }
    return `https://${cleaned}`;
}
