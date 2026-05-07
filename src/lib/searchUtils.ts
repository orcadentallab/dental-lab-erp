export const generateArabicSearchPattern = (term: string): string => {
    const tokens = Array.from(term.trim())
        .filter(char => !/\s/.test(char))
        .map(char => {
            if (/[اأإآ]/.test(char)) return '[اأإآ]';
            if (/[يى]/.test(char)) return '[يى]';
            if (/[هة]/.test(char)) return '[هة]';
            return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });

    return tokens.join('[[:space:]]*');
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
    const pattern = generateArabicSearchPattern(term).replace(/\[\[:space:\]\]\*/g, '\\s*');
    const regex = new RegExp(pattern, 'i');
    return regex.test(text);
};
