export const generateArabicSearchPattern = (term: string): string => {
    // Escape special regex characters
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace Arabic characters with character sets
    return escaped
        .replace(/[اأإآ]/g, '[اأإآ]')
        .replace(/[يى]/g, '[يى]')
        .replace(/[هة]/g, '[هة]');
};

export const normalizeArabicText = (text: string): string => {
    return text
        .replace(/[أإآ]/g, 'ا')
        .replace(/[ى]/g, 'ي')
        .replace(/[ة]/g, 'ه');
};

/**
 * Creates a PostgREST compatible regex string for client-side use if needed,
 * or for manual filtering.
 * Note: For Supabase .or(), we might need specific syntax.
 */
export const matchArabic = (text: string, term: string): boolean => {
    const pattern = generateArabicSearchPattern(term);
    const regex = new RegExp(pattern, 'i');
    return regex.test(text);
};
