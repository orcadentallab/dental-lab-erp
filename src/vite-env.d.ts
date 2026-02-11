/// <reference types="vite/client" />

declare module '*.ttf?url' {
    const src: string;
    export default src;
}

declare module 'arabic-reshaper' {
    const ArabicReshaper: {
        convertArabic(text: string): string;
        convertArabicBack(text: string): string;
    };
    export default ArabicReshaper;
}
