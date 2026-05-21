/**
 * Extracts the first valid web URL (absolute or domain-only) from a block of text.
 * Returns the extracted URL string, or null if no valid URL is found.
 */
export function extractUrl(text: string | undefined | null): string | null {
    if (!text) return null;
    
    // 1. Try to find an absolute URL (starting with http:// or https://)
    const absoluteUrlRegex = /(https?:\/\/[^\s"'`<>]+)/i;
    const absMatch = text.match(absoluteUrlRegex);
    if (absMatch) {
        let url = absMatch[1];
        // Clean trailing punctuation that might be captured (dots, commas, quotes, brackets)
        url = url.replace(/[.,)\]"'>]+$/, '');
        return url;
    }

    // 2. Try to find a domain-like pattern without http/https (e.g. drive.google.com/path or www.example.com)
    const domainUrlRegex = /((?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}(?:\/[^\s"'`<>]*)*)/i;
    const domainMatches = text.match(domainUrlRegex);
    if (domainMatches) {
        for (const match of domainMatches) {
            let url = match;
            url = url.replace(/[.,)\]"'>]+$/, '');
            
            // Check if it's a valid host part (before slash)
            const domainPart = url.split('/')[0];
            if (/^[a-zA-Z0-9.-]+$/.test(domainPart) && domainPart.includes('.')) {
                const parts = domainPart.split('.');
                const tld = parts[parts.length - 1];
                // TLD should be letters only and length 2 to 6
                if (/^[a-zA-Z]{2,6}$/.test(tld)) {
                    return url;
                }
            }
        }
    }

    return null;
}

/**
 * Cleans a URL/text by extracting the valid URL component if present.
 * If no valid URL is extracted, falls back to stripping markdown list markers and quotes.
 */
export function cleanUrl(url: string | undefined | null): string {
    if (!url) return '';
    const extracted = extractUrl(url);
    if (extracted) {
        return extracted;
    }
    
    // Fallback cleaning if no valid URL structure is found (to keep compatibility with basic inputs)
    let cleaned = url.trim();
    cleaned = cleaned.replace(/^[*\-+\s'"]+/, '').replace(/['"]+$/, '').trim();
    return cleaned;
}

/**
 * Validates whether a given string contains a valid web URL.
 */
export function isValidUrl(url: string | undefined | null): boolean {
    return extractUrl(url) !== null;
}

/**
 * Ensures that the URL has an absolute protocol prefix (https:// or http://).
 * Extracts and sanitizes the URL first.
 */
export function ensureAbsoluteUrl(url: string | undefined | null): string {
    const extracted = extractUrl(url);
    if (!extracted) {
        // Fallback to basic clean if nothing extracted (e.g., to not break completely if somehow called on a cleaned string)
        const cleaned = cleanUrl(url);
        if (!cleaned) return '';
        if (/^https?:\/\//i.test(cleaned)) {
            return cleaned;
        }
        return `https://${cleaned}`;
    }

    if (/^https?:\/\//i.test(extracted)) {
        return extracted;
    }
    return `https://${extracted}`;
}

