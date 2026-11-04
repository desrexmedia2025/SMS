/**
 * Tiny allow-list HTML sanitiser for the Notes editor.
 *
 * Note bodies come from a `contenteditable` surface, so the browser hands us free-form
 * HTML. Only a fixed set of formatting tags and attributes survives, every `javascript:` /
 * `data:` (non-image) URL is dropped and inline styles are restricted to harmless
 * text-formatting properties, which keeps stored notes safe to re-render as HTML.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'img', 'figure', 'figcaption', 'video', 'source',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'source']);

// Block-level tags that may keep a sanitised `style` attribute (alignment, colours).
const STYLE_TAGS = new Set([
  'p', 'div', 'span', 'li', 'blockquote', 'pre', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const ATTRS_BY_TAG = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  video: new Set(['src', 'controls', 'width', 'height', 'poster', 'preload', 'muted', 'loop']),
  source: new Set(['src', 'type']),
  td: new Set(['colspan', 'rowspan', 'style']),
  th: new Set(['colspan', 'rowspan', 'style', 'scope']),
  figure: new Set(['style']),
};

// Text-level formatting only - nothing that can load a resource or move a box around.
const STYLE_WHITELIST = new Set([
  'text-align', 'text-decoration', 'color', 'background-color',
  'font-size', 'font-weight', 'font-style', 'font-family',
  'margin-left', 'margin-right', 'padding-left', 'line-height',
]);

const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/))/i;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

function isSafeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (SAFE_DATA_IMAGE.test(raw)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !SAFE_URL.test(raw)) return false;
  if (raw.replace(/\s/g, '').toLowerCase().startsWith('javascript:')) return false;
  return SAFE_URL.test(raw) || raw.startsWith('#');
}

function sanitiseStyle(value) {
  return String(value || '')
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .filter((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return false;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).toLowerCase();
      if (!STYLE_WHITELIST.has(prop)) return false;
      // block any url(), expression() or import inside a value
      return !/url\(|expression\(|@import|javascript:/i.test(val);
    })
    .join('; ');
}

function splitAttrs(attrText) {
  const attrs = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
    attrs.push([name, value]);
  }
  return attrs;
}

function escapeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * @param {string} html raw editor HTML
 * @param {{ maxLength?: number }} [options]
 * @returns {string} safe HTML fragment
 */
function sanitizeNoteHtml(html, options = {}) {
  const maxLength = Number(options.maxLength || 400000);
  let input = String(html || '').slice(0, maxLength);

  // Strip dangerous blocks (and their contents) before any tag parsing happens.
  input = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>/gi, '');

  const out = [];
  const tagRe = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let lastIndex = 0;
  let match;

  while ((match = tagRe.exec(input)) !== null) {
    if (match.index > lastIndex) out.push(input.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    const closing = Boolean(match[1]);
    const tag = String(match[2] || '').toLowerCase();
    const attrText = match[3] || '';

    if (!ALLOWED_TAGS.has(tag)) continue;

    if (closing) {
      if (!VOID_TAGS.has(tag)) out.push(`</${tag}>`);
      continue;
    }
    if (VOID_TAGS.has(tag)) {
      const attrs = renderAttrs(tag, attrText);
      out.push(attrs ? `<${tag} ${attrs}>` : `<${tag}>`);
      continue;
    }
    const attrs = renderAttrs(tag, attrText);
    out.push(attrs ? `<${tag} ${attrs}>` : `<${tag}>`);
  }
  if (lastIndex < input.length) out.push(input.slice(lastIndex));

  return out.join('').trim();

  function renderAttrs(tag, attrText) {
    const allowed = ATTRS_BY_TAG[tag];
    const parts = [];
    for (const [name, value] of splitAttrs(attrText)) {
      if (name.startsWith('on')) continue;
      if (name === 'style') {
        if (!STYLE_TAGS.has(tag) && !(allowed && allowed.has('style'))) continue;
        const safeStyle = sanitiseStyle(value);
        if (safeStyle) parts.push(`style="${safeStyle}"`);
        continue;
      }
      if (name === 'rel') continue; // rewritten for every anchor below
      if (!allowed || !allowed.has(name)) continue;
      if (name === 'src' || name === 'href' || name === 'poster') {
        if (!isSafeUrl(value)) continue;
        parts.push(`${name}="${String(value).replace(/"/g, '&quot;')}"`);
        continue;
      }
      if (name === 'target') {
        parts.push('target="_blank"');
        continue;
      }
      const safe = String(value).replace(/"/g, '&quot;').slice(0, 300);
      parts.push(`${name}="${safe}"`);
    }
    if (tag === 'a') parts.push('rel="noopener noreferrer"');
    return parts.join(' ');
  }
}

/** Plain-text form of a note body, used for search excerpts and word counts. */
function noteHtmlToText(html) {
  const withBreaks = String(html || '')
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, ' ')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return withBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  return clean.split(/\s+/).length;
}

module.exports = { sanitizeNoteHtml, noteHtmlToText, countWords };
