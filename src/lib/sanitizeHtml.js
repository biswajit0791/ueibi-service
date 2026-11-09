/**
 * sanitizeHtml.js — make authored HTML safe to put on a public page.
 *
 * Legal documents are written by the platform owner in a rich text editor and
 * rendered to anyone visiting the signup page. That makes them the one place in
 * this product where stored HTML reaches an unauthenticated visitor, so the
 * HTML is sanitised HERE, on the server, at write time.
 *
 * Sanitising on write rather than on read matters: it means what is in the
 * database is already safe, so a second renderer added later cannot reintroduce
 * the hole by forgetting to clean it. The client sanitises again on render as
 * defence in depth, but this is the authoritative pass.
 *
 * The allowlist is deliberately narrow — what a legal document actually needs.
 * No script, no style, no iframe, no event handlers, no inline CSS.
 */
import sanitizeHtmlLib from 'sanitize-html';

const OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  // http/https/mailto only. Notably NOT javascript: or data:, which are the
  // two that turn a link into script execution.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // A link that opens a new tab without noopener hands the opener window to the
  // destination, so this is forced rather than left to the author.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
  },
  // Drop the contents of anything removed, so stripping <script> does not leave
  // its body behind as visible text.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
};

/** Returns HTML safe to render. Never throws on bad input; it strips it. */
export function sanitizeLegalHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtmlLib(dirty, OPTIONS);
}

/**
 * Plain text from authored HTML, for a meta description or a search index.
 * Strips every tag rather than escaping them.
 */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}


const GOAL_OPTIONS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'span', 'mark',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    '*': ['style', 'class', 'data-color'],
  },
  allowedStyles: {
    '*': {
      'color': [/.*/],
      'background-color': [/.*/],
      'text-align': [/^(left|right|center|justify)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
  },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
};

/**
 * Sanitizes rich text HTML for Goal descriptions, tasks, and notes.
 * Preserves safe formatting (headings, lists, bold/italic, alignment, colors, links)
 * while stripping XSS vectors (scripts, iframes, inline event handlers).
 */
export function sanitizeGoalHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtmlLib(dirty, GOAL_OPTIONS);
}
