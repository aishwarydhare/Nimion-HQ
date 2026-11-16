// Markdown for the chat: headings, lists (nested), tables, code blocks, quotes, rules, links, bold, italic, strike, inline code.
// It escapes HTML first, so nothing a nimion writes can inject markup, and links must be http(s).
// A plain script, so the page and test.mjs (node) both get globalThis.md and md.inline.
(() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  // File paths become candidates; the page asks the server which exist and links only those (see index.html, linkFiles).
  const cand = (p, html) => `<span class="fcand" data-path="${p}">${html}</span>`;
  const PATH = /^(?:file:\/\/\/|~\/|\/|\.{1,2}\/)?(?:[\w.@+-]+\/)*(?:[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+)?|)$/; // ends in name.ext, or in / for a folder
  const isPath = p => p.length > 2 && PATH.test(p) && (p.includes('/') || /\.\w+$/.test(p));
  // In running text, only clear cases: something with a slash, or a name with a document-like extension.
  const TEXT_PATH = /(^|[\s(*])((?:file:\/\/\/|~\/|\/|\.{1,2}\/)?(?:[\w.@+-]+\/)+(?:[\w.@+-]*[\w@+-])?|[\w@+-][\w.@+-]*\.(?:md|html?|pdf|csv|json|txt|png|jpe?g|svg|xlsx|docx|pptx|ipynb|log))(?=$|[\s),;:!?*]|\.(?:\s|$))/g;

  function inline(s) {
    const codes = []; // inline code is set aside so nothing inside it is formatted
    return esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => link(u, t))
      .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (m, t, p) => (isPath(p) ? cand(p, t) : m))
      .replace(TEXT_PATH, (m, pre, p) => (isPath(p) && !/^\/\//.test(p) ? pre + cand(p, p) : m))
      .replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, (_, pre, u) => pre + link(u, u))
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => (isPath(codes[i].trim()) ? cand(codes[i].trim(), `<code>${codes[i]}</code>`) : `<code>${codes[i]}</code>`));
  }

  const FENCE = /^\s*(```|~~~)/, HEAD = /^(#{1,6})\s+(.*)$/, RULE = /^\s*([-*_])(\s*\1){2,}\s*$/, QUOTE = /^\s*>/, ITEM = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
  const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/; // the |---|---| line under a table header
  const isTable = (lines, i) => lines[i].includes('|') && SEP.test(lines[i + 1] || '') && lines[i + 1].includes('-');
  const startsBlock = (lines, i) => FENCE.test(lines[i]) || HEAD.test(lines[i]) || RULE.test(lines[i]) || QUOTE.test(lines[i]) || ITEM.test(lines[i]) || isTable(lines, i);
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim()));

  function list(lines, i) {
    const items = [];
    for (; i < lines.length; i++) {
      const m = lines[i].match(ITEM);
      if (m) items.push({ ind: m[1].replace(/\t/g, '    ').length, ol: /\d/.test(m[2]), text: m[3] });
      else if (lines[i].trim() && /^\s/.test(lines[i]) && !startsBlock(lines, i)) items.at(-1).text += '\n' + lines[i].trim(); // wrapped item
      else break;
    }
    let html = '';
    const open = [];
    for (const it of items) {
      while (open.length && it.ind < open.at(-1).ind) html += `</li></${open.pop().tag}>`;
      if (!open.length || it.ind > open.at(-1).ind) { open.push({ ind: it.ind, tag: it.ol ? 'ol' : 'ul' }); html += `<${open.at(-1).tag}>`; }
      else html += '</li>';
      html += `<li>${it.text.split('\n').map(inline).join('<br>')}`;
    }
    while (open.length) html += `</li></${open.pop().tag}>`;
    return [html, i];
  }

  function md(src = '') {
    const lines = String(src ?? '').replace(/\r/g, '').split('\n'), out = [];
    for (let i = 0; i < lines.length;) {
      const l = lines[i];
      let m;
      if (!l.trim()) { i++; continue; }
      if (FENCE.test(l)) {
        const body = [];
        for (i++; i < lines.length && !FENCE.test(lines[i]); i++) body.push(lines[i]);
        i++;
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      } else if ((m = l.match(HEAD))) {
        const h = Math.min(m[1].length + 2, 6); // # is h3: headings stay small inside a chat bubble
        out.push(`<h${h}>${inline(m[2].replace(/\s#+\s*$/, ''))}</h${h}>`); i++;
      } else if (RULE.test(l)) { out.push('<hr>'); i++; }
      else if (isTable(lines, i)) {
        const head = cells(l), rows = [];
        for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
        out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
          rows.map(r => `<tr>${head.map((_, k) => `<td>${r[k] ?? ''}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>');
      } else if (QUOTE.test(l)) {
        const q = [];
        for (; i < lines.length && QUOTE.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${md(q.join('\n'))}</blockquote>`);
      } else if (ITEM.test(l)) {
        let html;
        [html, i] = list(lines, i);
        out.push(html);
      } else {
        const p = [l];
        for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) p.push(lines[i]);
        out.push(`<p>${p.map(inline).join('<br>')}</p>`);
      }
    }
    return out.join('');
  }

  md.inline = inline;
  globalThis.md = md;
})();
