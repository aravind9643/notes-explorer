// Pure note parsing and indexing. No `vscode` import, so it can be unit-tested with plain Node.
const fs = require('fs/promises');
const path = require('path');

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.log']);
const MAX_BYTES = 2 * 1024 * 1024; // skip huge files rather than freeze on them

const TASK_RE = /^(\s*[-*+]\s+)\[( |x|X)\]\s+(.*)$/;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const DONE_RE = /\s*✓\s*(\d{4}-\d{2}-\d{2})\s*$/;
// A tag starts a word, begins with a letter, and is not a Markdown heading ("# Title") or URL fragment ("(#anchor)")
const TAG_RE = /(?:^|[\s,;])#([A-Za-z][\w/-]*)/g;
const LINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g;

function parseNote(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [], tags = new Set(), links = [], headings = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2], line: i });
    const t = TASK_RE.exec(line);
    // Example lines from the built-in templates ("- [ ] _e.g. …_") aren't real tasks until they're edited
    if (t && !/^_e\.g\./i.test(t[3].trim())) {
      const due = DUE_RE.exec(t[3]);
      const doneOn = DONE_RE.exec(t[3]);
      const taskTags = [...t[3].matchAll(TAG_RE)].map(m => m[1].toLowerCase());
      tasks.push({
        line: i, done: t[2] !== ' ', text: t[3].replace(DUE_RE, '').replace(DONE_RE, '').trim(),
        due: due ? due[1] : null, doneOn: doneOn ? doneOn[1] : null, tags: taskTags
      });
    }
    // `inline code` is blanked out (same length, so columns stay right): examples there are not links or tags
    const prose = line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length));
    for (const m of prose.matchAll(TAG_RE)) tags.add(m[1].toLowerCase());
    for (const m of prose.matchAll(LINK_RE)) links.push({ target: m[1].trim(), heading: m[2] ? m[2].trim() : null, line: i, col: m.index, length: m[0].length });
  });
  return { lines, tasks, tags: [...tags], links, headings };
}

const noteKey = (file) => path.basename(file, path.extname(file)).toLowerCase();

class NoteIndex {
  constructor() { this.cache = new Map(); this.root = null; }

  invalidate(file) { if (file) this.cache.delete(file); else this.cache.clear(); }

  /** Lists all files under root (async), skipping hidden folder names. */
  async listFiles(root, hidden, { exclude, maxFiles = Infinity } = {}) {
    const out = [];
    const walk = async (dir) => {
      if (out.length >= maxFiles) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      await Promise.all(entries.map(async (e) => {
        const p = path.join(dir, e.name);
        if (exclude && exclude(path.relative(root, p), e.isDirectory())) return;
        if (e.isDirectory()) { if (!hidden.has(e.name)) await walk(p); }
        else if (e.isFile() && out.length < maxFiles) out.push(p);
      }));
    };
    await walk(root);
    return out.sort();
  }

  /** Re-parses only files whose mtime changed since last scan. Returns Map<file, parsed>. */
  async scan(root, hidden, opts = {}) {
    if (root !== this.root) { this.cache.clear(); this.root = root; }
    const all = await this.listFiles(root, hidden, opts);
    this.truncated = Number.isFinite(opts.maxFiles) && all.length >= opts.maxFiles;
    const files = all.filter(f => TEXT_EXT.has(path.extname(f).toLowerCase()));
    const live = new Set(files);
    for (const f of this.cache.keys()) if (!live.has(f)) this.cache.delete(f);
    await Promise.all(files.map(async (f) => {
      try {
        const st = await fs.stat(f);
        const hit = this.cache.get(f);
        if (hit && hit.mtime === st.mtimeMs) return;
        if (st.size > MAX_BYTES) { this.cache.set(f, { mtime: st.mtimeMs, ...parseNote('') }); return; }
        this.cache.set(f, { mtime: st.mtimeMs, ...parseNote(await fs.readFile(f, 'utf8')) });
      } catch { this.cache.delete(f); } // locked or vanished mid-scan: skip it
    }));
    return this.cache;
  }

  /**
   * Options: matchCase, wholeWord, regex (query is a regular expression),
   * folder (only files under this path), tag (only files carrying this tag).
   * Throws on an invalid regular expression so the caller can show the message.
   */
  search(query, opts = {}) {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(opts.wholeWord ? `(?<![\\w])(?:${src})(?![\\w])` : src, opts.matchCase ? '' : 'i');
    const folder = opts.folder && opts.folder.toLowerCase().replace(/[\\/]+$/, '') + path.sep;
    const hits = [];
    for (const [file, n] of this.cache) {
      if (folder && !file.toLowerCase().startsWith(folder)) continue;
      if (opts.tag && !n.tags.includes(opts.tag)) continue;
      n.lines.forEach((line, i) => {
        const m = re.exec(line);
        if (m && m[0].length) hits.push({ file, line: i, col: m.index, length: m[0].length, text: line });
      });
    }
    return hits;
  }

  allTasks() {
    const out = [];
    for (const [file, n] of this.cache) for (const t of n.tasks) out.push({ file, ...t });
    return out;
  }

  openTasks() {
    const out = [];
    for (const [file, n] of this.cache) for (const t of n.tasks) if (!t.done) out.push({ file, ...t });
    return out;
  }

  allTags() {
    const counts = new Map();
    for (const n of this.cache.values()) for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  filesWithTag(tag) {
    return [...this.cache].filter(([, n]) => n.tags.includes(tag)).map(([f]) => f);
  }

  resolveLink(target) {
    const key = target.toLowerCase().replace(/\.md$/, '');
    for (const f of this.cache.keys()) if (noteKey(f) === key) return f;
    return null;
  }

  /** Nodes = notes, edges = resolved [[links]]. Unresolved targets become "missing" nodes. */
  graph() {
    const nodes = new Map(), edges = [];
    for (const f of this.cache.keys()) nodes.set(f, { id: f, name: path.basename(f, path.extname(f)), missing: false, links: 0 });
    for (const [f, n] of this.cache)
      for (const l of n.links) {
        let to = this.resolveLink(l.target);
        if (!to) {
          to = `missing:${l.target.toLowerCase()}`;
          if (!nodes.has(to)) nodes.set(to, { id: to, name: l.target, missing: true, links: 0 });
        }
        if (to === f || edges.some(e => e.from === f && e.to === to)) continue;
        edges.push({ from: f, to });
        nodes.get(f).links++; nodes.get(to).links++;
      }
    return { nodes: [...nodes.values()], edges };
  }

  /** Line of a heading in a note (case-insensitive), or null. */
  headingLine(file, heading) {
    const n = this.cache.get(file);
    const h = n && n.headings.find(x => x.text.toLowerCase() === String(heading).toLowerCase());
    return h ? h.line : null;
  }

  /** [[links]] whose target note doesn't exist, for one file. */
  unresolvedLinks(file) {
    const n = this.cache.get(file);
    return n ? n.links.filter(l => !this.resolveLink(l.target)) : [];
  }

  backlinks(file) {
    const key = noteKey(file), out = [];
    for (const [f, n] of this.cache)
      for (const l of n.links) if (l.target.toLowerCase().replace(/\.md$/, '') === key) out.push({ file: f, line: l.line, text: n.lines[l.line] });
    return out;
  }
}

module.exports = { parseNote, NoteIndex, noteKey, TEXT_EXT };
