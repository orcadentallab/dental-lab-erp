export const DESIGN_EXECUTION_MAX_BYTES = 50 * 1024 * 1024;
export const DESIGN_HTML_MAX_BYTES = 10 * 1024 * 1024;
export function validateDesignFiles(execution: File, html?: File | null): void {
    if (!/\.zip$/i.test(execution.name) || execution.size < 1 || execution.size > DESIGN_EXECUTION_MAX_BYTES) throw new Error('اختر حزمة ZIP كاملة لا تتجاوز 50 ميجا');
    if (html && (!/\.html?$/i.test(html.name) || html.size < 1 || html.size > DESIGN_HTML_MAX_BYTES)) throw new Error('اختر HTML مستقلًا لا يتجاوز 10 ميجا');
}
/** Opaque sandbox + CSP: no ERP origin, network, parent navigation or credentials. */
export function isolatedDesignHtml(html: string): string {
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'">' + html;
}
