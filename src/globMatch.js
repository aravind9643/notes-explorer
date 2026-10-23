// Minimal .gitignore-style matching for excluding files from the notes index. No `vscode` import.
//   build/        a folder anywhere           *.log      a file name anywhere
//   /drafts       only at the notes root      docs/**/x  "**" spans folders
//   !keep.log     re-include a previous match
const path = require('path');

function toRegex(pattern) {
  let p = pattern.trim();
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') { re += '.*'; i++; if (p[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A pattern matches the path itself or anything inside it
  return { re: new RegExp(`${anchored ? '^' : '(^|/)'}${re}(/.*)?$`, 'i'), dirOnly };
}

/** Compiles patterns (comments and blank lines ignored) into a matcher for paths relative to the root. */
function compileExcludes(patterns) {
  const rules = (patterns || [])
    .map(s => String(s).trim())
    .filter(s => s && !s.startsWith('#'))
    .map(s => (s.startsWith('!') ? { negate: true, ...toRegex(s.slice(1)) } : { negate: false, ...toRegex(s) }));
  return (relPath, isDir = false) => {
    const rel = relPath.split(path.sep).join('/').replace(/^\/+/, '');
    let excluded = false;
    for (const r of rules) {
      // "folder/" never matches a file itself, only files inside such a folder
      const subject = r.dirOnly && !isDir ? rel.split('/').slice(0, -1).join('/') : rel;
      if (subject && r.re.test(subject)) excluded = !r.negate;
    }
    return excluded;
  };
}

module.exports = { compileExcludes };
