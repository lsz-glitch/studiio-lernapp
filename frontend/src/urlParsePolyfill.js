/**
 * pdfjs-dist (react-pdf) nutzt statisches URL.parse — in vielen Browsern noch nicht verfügbar.
 * Ohne Polyfill: "URL.parse is not a function" im KI-Tutor.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/URL/parse_static
 */
if (typeof URL !== 'undefined' && typeof URL.parse !== 'function') {
  URL.parse = function urlParse(url, base) {
    if (url instanceof URL) return url
    try {
      const baseStr =
        base === undefined || base === null
          ? undefined
          : typeof base === 'string'
            ? base
            : base instanceof URL
              ? base.href
              : typeof base === 'object' && base !== null && 'href' in base
                ? String(base.href)
                : String(base)
      return new URL(String(url), baseStr)
    } catch {
      return null
    }
  }
}
