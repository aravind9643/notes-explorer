// Removes active content from rendered note HTML before export, so a pasted <script> or onclick in a
// note can't run when someone opens the exported file. Exports also carry a CSP that blocks scripts,
// so this is a second layer. No `vscode` import.

const DANGEROUS_TAGS = ['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'applet', 'base', 'form', 'meta', 'link', 'noscript', 'template'];

function sanitizeHtml(html) {
  let out = String(html);
  for (const tag of DANGEROUS_TAGS) {
    // Paired tags with their content, then any stray opening/closing/self-closing tags
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '');
  }
  // Event handler attributes: onclick="…", onload='…', onerror=…
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript:, vbscript: and data:text/html URLs in href/src/action/xlink:href/formaction
  out = out.replace(/\s+((?:xlink:)?href|src|action|formaction|poster|background)\s*=\s*("|')\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, ' $1="#"');
  out = out.replace(/\s+((?:xlink:)?href|src|action|formaction)\s*=\s*(?:javascript|vbscript):[^\s>]*/gi, ' $1="#"');
  // Inline style expressions (old IE) and srcdoc
  out = out.replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return out;
}

const EXPORT_CSP = "default-src 'none'; img-src file: data: https: http:; style-src 'unsafe-inline'; font-src file: data: https:";

module.exports = { sanitizeHtml, EXPORT_CSP };
