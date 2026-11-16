/* Nimion HQ: small pure helpers for the page (no DOM), also run by test.mjs. Sets globalThis.HQW. */
(function (g) {
  'use strict';
  // The boss memory, one item per line: a "- " bullet loses its dash; other lines stay as they are.
  function memoryItems(text) {
    return String(text == null ? '' : text).split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^[-*•]\s+/, ''));
  }
  // Back to the one text the boss reads: every item a "- " bullet on one line.
  function memoryText(items) {
    return (items || []).map(t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim()).filter(Boolean).map(t => '- ' + t).join('\n');
  }
  // Deep links: #job/12 opens that chat; #<panel> opens a panel.
  function parseHash(hash, panels) {
    const s = String(hash || '').replace(/^#\/?/, '');
    const m = s.match(/^job\/(\d+)$/);
    if (m) return { job: Number(m[1]) };
    const p = s === 'nr' ? 'mr' : s; // the NR office keeps its older id
    return (panels || []).includes(p) ? { panel: p } : null;
  }
  // A still nimion portrait (SVG markup) for profile cards: a body in its colour, big eyes, its style's top and outfit, and a prop. All original art.
  const darken = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
  const HAND = {
    wrench: '<g transform="translate(102 124) rotate(-30)"><rect x="-3" y="-32" width="6" height="30" rx="2.5" fill="#8d96a3"/><path d="M-9 -40 a9 9 0 1 0 18 0 h-5 v6 h-8 v-6 z" fill="#8d96a3"/></g>',
    lens: '<g transform="translate(102 124) rotate(-25)"><rect x="-3" y="-22" width="6" height="18" rx="2.5" fill="#7a5130"/><circle cx="0" cy="-32" r="11" fill="#bfe3ff" fill-opacity=".55" stroke="#3d3d3d" stroke-width="3.5"/></g>',
    paintbrush: '<g transform="translate(102 124) rotate(-28)"><rect x="-2.5" y="-30" width="5" height="27" rx="2" fill="#b5793f"/><rect x="-3.5" y="-37" width="7" height="8" fill="#c3c9d3"/><path d="M-3.5 -37 Q0 -52 3.5 -37 Z" fill="#e0447a"/></g>',
    flask: '<g transform="translate(102 120)"><path d="M-4 -28 h8 v10 l9 15 q2 5 -3 5 h-20 q-5 0 -3 -5 l9 -15 z" fill="#e8f6ff" fill-opacity=".85" stroke="#5a6b7d" stroke-width="2"/><path d="M-9.6 -7 h19.2 l2.6 4.2 q1 2.8 -2.4 2.8 h-19.6 q-3.4 0 -2.4 -2.8 z" fill="#5fd38a"/></g>',
    mug: '<g transform="translate(102 118)"><rect x="-8" y="-14" width="16" height="18" rx="3" fill="#fff" stroke="#7d8593" stroke-width="2"/><path d="M8 -9 q7 0 7 5 t-7 5" fill="none" stroke="#7d8593" stroke-width="2.5"/><rect x="-8" y="-6" width="16" height="4" fill="#d64545"/><path d="M-4 -19 q2 -4 0 -7 M2 -19 q2 -4 0 -7" stroke="#c3c9d3" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>',
    hammer: '<g transform="translate(102 124) rotate(-25)"><rect x="-2.5" y="-34" width="5" height="32" rx="2" fill="#b5793f"/><rect x="-12" y="-43" width="24" height="10" rx="2" fill="#6f7682"/><rect x="-12" y="-43" width="24" height="3" rx="1.5" fill="#9aa3b2"/></g>',
    book: '<g transform="translate(104 116) rotate(-8)"><rect x="-11" y="-15" width="22" height="28" rx="2" fill="#2f5ea8"/><rect x="-11" y="-15" width="4" height="28" fill="#244a86"/><rect x="-4" y="-9" width="11" height="3" rx="1" fill="#ffd84d"/><rect x="-4" y="-4" width="8" height="2" rx="1" fill="#cfe9ff"/></g>',
    pencil: '<g transform="translate(102 124) rotate(-35)"><rect x="-3" y="-32" width="6" height="26" fill="#ffc83d"/><rect x="-3" y="-37" width="6" height="5" rx="1.5" fill="#ff9aa8"/><rect x="-3" y="-32" width="6" height="2" fill="#c3c9d3"/><path d="M-3 -6 L0 3 L3 -6 Z" fill="#e8c9a0"/><path d="M-1.2 -0.6 L0 3 L1.2 -0.6 Z" fill="#2b2a33"/></g>',
  };
  const WORN = {
    hat: '<path d="M30 32 Q30 5 60 5 Q90 5 90 32 Z" fill="#f08c00"/><rect x="24" y="28" width="72" height="8" rx="4" fill="#cf7400"/><rect x="55" y="6" width="10" height="24" rx="4" fill="#ffa833"/>',
    clipboard: '<g transform="translate(15 112) rotate(-10)"><rect x="-13" y="-17" width="26" height="32" rx="3" fill="#a3713f"/><rect x="-10" y="-12" width="20" height="24" fill="#fff"/><path d="M-6 -6h12M-6 -1h12M-6 4h8" stroke="#b5b5b5" stroke-width="1.6"/><rect x="-5" y="-20" width="10" height="6" rx="2" fill="#6f6f6f"/></g>',
    laptop: '<g transform="translate(14 114) rotate(-12)"><rect x="-15" y="-11" width="30" height="20" rx="2" fill="#9aa3b2"/><rect x="-12.5" y="-8.5" width="25" height="14" rx="1" fill="#2b3a55"/><path d="M-9 -4h11M-9 0h15M-9 4h8" stroke="#7fd1ff" stroke-width="1.6"/><rect x="-17" y="9" width="34" height="3.5" rx="1.7" fill="#7d8593"/></g>',
    headset: '<path d="M29 50 Q29 3 60 3 Q91 3 91 50" stroke="#3b3946" stroke-width="5" fill="none"/><rect x="21" y="40" width="11" height="20" rx="4" fill="#3b3946"/><rect x="88" y="40" width="11" height="20" rx="4" fill="#3b3946"/><path d="M26 59 Q29 80 45 82" stroke="#3b3946" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="46" cy="82" r="3.4" fill="#d64545"/>',
    cap: '<path d="M30 30 Q30 7 60 7 Q90 7 90 30 Z" fill="#d64545"/><path d="M60 26 h38 q5 0 2 5 h-40 z" fill="#b83535"/><circle cx="60" cy="8" r="3" fill="#b83535"/><path d="M45 12 Q60 9 75 12" stroke="#f4f1e8" stroke-width="2" fill="none"/>',
    beanie: '<path d="M30 32 Q30 5 60 5 Q90 5 90 32 Z" fill="#2e9e5b"/><rect x="27" y="26" width="66" height="10" rx="4" fill="#25804a"/><path d="M40 26 v10 M50 26 v10 M60 26 v10 M70 26 v10 M80 26 v10" stroke="#1f6b3e" stroke-width="1.5"/><circle cx="60" cy="4" r="6.5" fill="#f4f1e8"/>',
    tophat: '<rect x="41" y="-14" width="38" height="36" rx="3" fill="#2b2a33"/><rect x="41" y="11" width="38" height="6" fill="#d64545"/><rect x="25" y="20" width="70" height="7" rx="3.5" fill="#2b2a33"/>',
    crown: '<path d="M34 28 L34 6 L46 17 L60 1 L74 17 L86 6 L86 28 Z" fill="#ffc83d" stroke="#c99a00" stroke-width="2" stroke-linejoin="round"/><circle cx="60" cy="18" r="3.6" fill="#d64545"/><circle cx="45" cy="22" r="2.6" fill="#4fb3ff"/><circle cx="75" cy="22" r="2.6" fill="#4fb3ff"/>',
    headphones: '<path d="M27 54 Q27 2 60 2 Q93 2 93 54" stroke="#b04fd0" stroke-width="7" fill="none"/><rect x="16" y="38" width="15" height="28" rx="7" fill="#b04fd0"/><rect x="89" y="38" width="15" height="28" rx="7" fill="#b04fd0"/><rect x="19" y="43" width="7" height="18" rx="3.5" fill="#8a3aa6"/><rect x="94" y="43" width="7" height="18" rx="3.5" fill="#8a3aa6"/>',
    bowtie: '<g transform="translate(60 89)"><path d="M0 0 L-13 -8 L-13 8 Z M0 0 L13 -8 L13 8 Z" fill="#d64545"/><circle r="3.4" fill="#b83535"/></g>',
    glasses: e => e.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 7}" fill="none" stroke="#7a3b1e" stroke-width="3"/>`).join('') + (e.length > 1 ? '<path d="M51 52 h18" stroke="#7a3b1e" stroke-width="3"/>' : ''),
    sunglasses: e => e.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 6}" fill="#1c1b23" fill-opacity=".88" stroke="#111" stroke-width="2.5"/><path d="M${x - r * .6} ${y - r * .45} q${r * .4} -${r * .35} ${r * .9} -${r * .25}" stroke="#fff" stroke-opacity=".7" stroke-width="2" fill="none"/>`).join('') + (e.length > 1 ? '<path d="M51 50 h18" stroke="#111" stroke-width="3"/>' : ''),
  };
  // The three styles a nimion can have. Each is a top (on its head) and an outfit, drawn here in 2D and in lab3d.js in 3D.
  const STYLES = [['sprout', 'Sprout'], ['bobble', 'Bobble'], ['tuft', 'Tuft']];
  const styleOf = look => (STYLES.some(([k]) => k === (look && look.style)) ? look.style : 'sprout');
  const TONE = '#ffaa33'; // the body colour of a nimion that has none set
  const lighten = (hex, k) => '#' + [1, 3, 5].map(i => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * k).toString(16).padStart(2, '0'); }).join('');
  const hue = hex => { // 0 to 360, or -1 for a grey
    const [r, gr, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, gr, b), d = mx - Math.min(r, gr, b);
    return d < .04 ? -1 : ((mx === r ? ((gr - b) / d) % 6 : mx === gr ? (b - r) / d + 2 : (r - gr) / d + 4) * 60 + 360) % 360;
  };
  // What a nimion wears is in its own colour (its tint). When that is too close to its body colour, a deeper shade is used so it still shows.
  function accent(tone, tint) {
    const ok = v => /^#[0-9a-f]{6}$/i.test(v || '');
    if (!ok(tint)) return '#f08c00';
    const a = ok(tone) ? hue(tone) : -1, b = hue(tint), d = a < 0 || b < 0 ? 180 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    return d < 28 ? darken(tint, .38) : tint;
  }
  let pid = 0;
  function portrait(look, tint) {
    look = look && typeof look === 'object' ? look : {};
    const pack = g.HQ_CLASSIC; // an optional look pack, loaded before this file when the server offers one
    if (pack && pack.portrait) return pack.portrait(look, { darken, HAND, WORN, uid: 'pv' + (++pid) });
    const tone = /^#[0-9a-f]{6}$/i.test(look.tone || '') ? look.tone : TONE, prop = look.prop, uid = 'pv' + (++pid), style = styleOf(look), gum = style === 'bobble';
    const acc = accent(tone, tint), accD = darken(acc, .18), cream = '#fff4dc';
    const arm = darken(tone, .05), side = darken(tone, .1), edge = darken(tone, .22), deep = darken(tone, .34), light = lighten(tone, .62);
    const eyes = look.eyes === 1 ? [[60, 54, 17]] : [[45.5, 54, 13], [74.5, 54, 13]];
    const eye = ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 1.3}" fill="#3b2a20"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/>` +
      `<circle cx="${x}" cy="${y + 1}" r="${r * .6}" fill="#6b4322"/><circle cx="${x}" cy="${y + 1}" r="${r * .32}" fill="#111"/>` +
      `<circle cx="${x + r * .27}" cy="${y - r * .25}" r="${r * .18}" fill="#fff"/><circle cx="${x - r * .24}" cy="${y + r * .34}" r="${r * .09}" fill="#fff"/>`;
    const limb = (d, c = arm, w = 8) => `<path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
    const body = gum ? 'M28 46 Q28 14 60 14 Q92 14 92 46 L96 116 Q96 148 60 148 Q24 148 24 116 Z' : 'M28 46 Q28 14 60 14 Q92 14 92 46 L92 114 Q92 146 60 146 Q28 146 28 114 Z';
    const shoe = style === 'tuft' ? acc : cream, shoeE = style === 'tuft' ? accD : '#d9c9a3';
    const foot = x => `<rect x="${x - 6}" y="136" width="12" height="18" fill="${arm}"/><ellipse cx="${x + (x < 60 ? -2 : 2)}" cy="156" rx="11" ry="5.5" fill="${shoe}" stroke="${shoeE}" stroke-width="1.2"/>` +
      (gum ? `<ellipse cx="${x + (x < 60 ? -7 : 7)}" cy="157" rx="5" ry="3.6" fill="${acc}"/>` : '');
    const top = ['hat', 'cap', 'beanie', 'tophat', 'crown'].includes(prop) ? '' : style === 'sprout'
      ? `<path d="M60 16 v-11" stroke="#3f9d4f" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="51" cy="3" rx="10" ry="4.6" fill="#5cc46a" transform="rotate(-24 51 3)"/><ellipse cx="69" cy="3" rx="10" ry="4.6" fill="#5cc46a" transform="rotate(24 69 3)"/>`
      : gum ? `<path d="M60 16 q2 -8 5 -14" stroke="#5b5560" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="66" cy="-2" r="6" fill="${acc}"/>`
        : `<circle cx="51" cy="14" r="7" fill="${deep}"/><circle cx="60" cy="9" r="9" fill="${deep}"/><circle cx="70" cy="14" r="6.5" fill="${deep}"/><circle cx="65" cy="2" r="4" fill="${deep}"/>`;
    const wear = style === 'sprout' // inside the body's outline
      ? `<path d="M28 88 Q60 100 92 88 L92 101 Q60 113 28 101 Z" fill="${acc}"/><path d="M28 99 Q60 111 92 99" stroke="${accD}" stroke-width="1.4" fill="none" opacity=".6"/>`
      : gum ? `<ellipse cx="60" cy="116" rx="23" ry="25" fill="${light}"/>`
        : `<rect x="22" y="91" width="76" height="13" fill="${acc}"/><rect x="22" y="104" width="76" height="13" fill="${cream}"/><rect x="22" y="117" width="76" height="13" fill="${acc}"/>`;
    const over = style === 'sprout' // on top of the outline
      ? `<circle cx="76" cy="103" r="6.5" fill="${acc}" stroke="${accD}" stroke-width="1.2"/><path d="M72 106 l-5 17 l10 -3 z M79 107 l7 15 l-10 0 z" fill="${acc}" stroke="${accD}" stroke-width="1.2" stroke-linejoin="round"/>`
      : gum ? `<path d="M44 93 L60 110 L76 93" stroke="${acc}" stroke-width="2.4" fill="none" stroke-linejoin="round"/><g transform="rotate(4 60 121)"><rect x="50" y="109" width="20" height="25" rx="3" fill="#fff" stroke="#b9c0cc" stroke-width="1.4"/><circle cx="60" cy="118" r="4.4" fill="${acc}"/><path d="M54 126 h12 M55.5 130 h9" stroke="#b9c0cc" stroke-width="1.6" stroke-linecap="round"/></g>`
        : '';
    const sleeves = style === 'tuft' ? limb('M31 98 Q22 103 19 111', acc, 10) + limb('M89 98 Q98 103 101 111', acc, 10) : '';
    return `<svg class="mpv" viewBox="0 -14 120 184" aria-hidden="true"><ellipse cx="60" cy="163" rx="${gum ? 36 : 32}" ry="5" fill="#000" opacity=".14"/>
      ${foot(48)}${foot(72)}
      ${limb('M31 98 Q15 108 18 124')}<circle cx="18" cy="126" r="6.5" fill="${arm}"/>${limb('M89 98 Q105 108 102 124')}<circle cx="102" cy="126" r="6.5" fill="${arm}"/>${sleeves}
      <clipPath id="${uid}"><path d="${body}"/></clipPath>
      <g clip-path="url(#${uid})"><rect x="20" y="10" width="80" height="142" fill="${tone}"/><rect x="76" y="10" width="24" height="142" fill="${side}" opacity=".5"/>${wear}</g>
      <path d="${body}" fill="none" stroke="${edge}" stroke-width="2"/>${over}${HAND[prop] || ''}${top}${eyes.map(eye).join('')}
      <ellipse cx="34" cy="77" rx="6.5" ry="4.2" fill="#ff8fa3" opacity=".6"/><ellipse cx="86" cy="77" rx="6.5" ry="4.2" fill="#ff8fa3" opacity=".6"/>
      <path d="M50 79 Q60 88 70 79" stroke="#5a2a1a" stroke-width="2.6" fill="none" stroke-linecap="round"/>${typeof WORN[prop] === 'function' ? WORN[prop](eyes) : WORN[prop] || ''}</svg>`;
  }

  // The mission board: jobs grouped by the thread they came from. A thread is a job the human gave the boss, with the steps the boss
  // handed out under it; jobs given straight to a nimion share "Direct jobs", and scheduled runs (with their steps) share "Scheduled".
  // Groups that need the human come first, then working, queued, and finished (newest first); steps stay in plan order.
  const RANK = { 'needs-you': 0, working: 1, queued: 2 }, FIN = ['done', 'failed', 'stopped'];
  const rank = st => (st in RANK ? RANK[st] : 3);
  function boardGroups(tasks, boss) {
    const byId = new Map(tasks.map(t => [t.id, t])), groups = new Map();
    const rootOf = t => { for (let i = 0; t.parent && byId.has(t.parent) && i < 50; i++) t = byId.get(t.parent); return t; };
    const group = (key, base) => groups.get(key) || groups.set(key, { key, items: [], ...base }).get(key);
    for (const t of tasks) {
      const r = rootOf(t);
      if (r.schedule) group('sched', { kind: 'sched', title: 'Scheduled' }).items.push(t);
      else if (r.parent) group('job:' + r.parent, { kind: 'thread', id: r.parent, root: null, title: `Job #${r.parent} (cleared)` }).items.push(t); // its boss job was cleared
      else if (r !== t || r.nimion === boss) { const g = group('job:' + r.id, { kind: 'thread', id: r.id }); g.root = r; g.title = r.title; if (r !== t) g.items.push(t); }
      else group('direct', { kind: 'direct', title: 'Direct jobs' }).items.push(t);
    }
    return [...groups.values()].map(g => {
      const all = (g.root ? [g.root] : []).concat(g.items), open = all.filter(t => !FIN.includes(t.status));
      const status = open.length ? open.map(t => t.status).sort((a, b) => rank(a) - rank(b))[0]
        : g.root ? g.root.status : all.some(t => t.status === 'failed') ? 'failed' : 'done';
      if (g.kind === 'thread') g.items.sort((a, b) => a.id - b.id);
      else g.items.sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id);
      return { ...g, status, done: g.items.filter(t => FIN.includes(t.status)).length, total: g.items.length,
        at: Math.max(0, ...all.map(t => t.created || 0)), finished: !open.length };
    }).sort((a, b) => rank(a.status) - rank(b.status) || b.at - a.at);
  }

  // Usage: the sum of every recorded run (task.runs) at or after `since`. tokens = in + out + cache reads and writes.
  // cost is the notional API price the CLI reports (a subscription is not billed per run); costRuns says how many runs had one.
  function sumUsage(tasks, since = 0) {
    const s = { in: 0, out: 0, cacheR: 0, cacheW: 0, tokens: 0, ms: 0, turns: 0, runs: 0, jobs: 0, cost: 0, costRuns: 0 };
    for (const t of tasks || []) {
      let any = false;
      for (const r of t.runs || []) {
        if (!(r.at >= since)) continue;
        for (const k of ['in', 'out', 'cacheR', 'cacheW', 'ms', 'turns']) s[k] += r[k] || 0;
        if (Number.isFinite(r.cost)) { s.cost += r.cost; s.costRuns++; }
        s.runs++; any = true;
      }
      if (any) s.jobs++;
    }
    s.tokens = s.in + s.out + s.cacheR + s.cacheW;
    return s;
  }
  // 1234 -> "1.2k", 3456789 -> "3.5M"
  const kfmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(Math.round(n)));

  // Command palette match: every query character, in order, case-insensitive. -1 = no match. Higher is better: a run of
  // consecutive characters, the start of a word, or the whole query as one piece score more; shorter labels win a tie.
  function fuzzy(query, text) {
    const q = String(query || '').toLowerCase().replace(/\s+/g, ''), t = String(text || '').toLowerCase();
    if (!q) return 0;
    let score = 0, from = 0, run = 0;
    for (const ch of q) {
      const i = t.indexOf(ch, from);
      if (i < 0) return -1;
      run = i === from && from > 0 ? run + 1 : 0;
      score += 1 + run * 2 + (i === 0 || /[\s\-_/#·.:()]/.test(t[i - 1]) ? 3 : 0);
      from = i + 1;
    }
    const at = t.indexOf(String(query).toLowerCase().trim());
    const wordStart = at === 0 || (at > 0 && /[\s\-_/#·.:()]/.test(t[at - 1]));
    return score + (at < 0 ? 0 : wordStart ? 10 + (at === 0 ? 5 : 0) : 2) - t.length * 0.01; // initials beat a match inside a word
  }

  // Nimion colours: a small tested set that reads well on the nimions in light and dark (see test.mjs). A saved colour
  // outside the set still works and shows as "custom".
  const SWATCHES = [['Banana', '#ffd84d'], ['Lemon', '#fff07a'], ['Mango', '#ffaa33'], ['Tangerine', '#ff8040'], ['Coral', '#ff7a6b'], ['Bubblegum', '#ff7aa8'],
    ['Lilac', '#c9a7ff'], ['Sky', '#7cc8ff'], ['Mint', '#7fe0b0'], ['Lime', '#b8e85c'], ['Sand', '#e8c99a'], ['Cloud', '#e6e9f0']];
  const swatchName = tone => (SWATCHES.find(([, hex]) => hex.toLowerCase() === String(tone || '').toLowerCase()) || ['custom'])[0];

  // A repeat rule (5-field cron) in words, for the popup, the chat and the boss. Shapes it does not know stay as the rule.
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const two = n => String(n).padStart(2, '0');
  const and = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function dayWords(dow) {
    if (dow === '1-5') return 'Weekdays';
    if (/^(0,6|6,0)$/.test(dow)) return 'Weekends';
    let m = dow.match(/^([0-7])-([0-7])$/);
    if (m) return `${DAYS[m[1] % 7]} to ${DAYS[m[2] % 7]}`;
    if (!/^[0-7](,[0-7])*$/.test(dow)) return null;
    const ds = [...new Set(dow.split(',').map(d => d % 7))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
    return ds.length === 1 ? DAYS[ds[0]] + 's' : and(ds.map(d => DAYS[d].slice(0, 3)));
  }
  function describeCron(expr) {
    const f = String(expr == null ? '' : expr).trim().split(/\s+/), rule = f.join(' ');
    if (f.length !== 5 || f[3] !== '*') return rule;
    const [mi, h, dom, , dow] = f;
    if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && dow === '*') return `Every ${mi.slice(2)} minutes`;
    if (!/^\d+$/.test(mi)) return rule;
    const m = Number(mi), step = h.match(/^\*\/(\d+)$/);
    if (h === '*' && dom === '*' && dow === '*') return m ? `Every hour at :${two(m)}` : 'Every hour';
    if (step && dom === '*' && dow === '*') return `Every ${step[1]} hours${m ? ` at :${two(m)}` : ''}`;
    if (!/^\d+(,\d+)*$/.test(h)) return rule;
    const at = 'at ' + and(h.split(',').map(x => `${two(x)}:${two(m)}`));
    if (dom === '*' && dow === '*') return `Every day ${at}`;
    if (dom === '*') { const d = dayWords(dow); return d ? `${d} ${at}` : rule; }
    if (dow === '*' && /^\d+$/.test(dom)) return `On the ${ord(Number(dom))} of each month ${at}`;
    return rule;
  }
  // The popup's repeat presets, to a cron rule and back. A rule no preset makes comes back as { kind: 'cron' }.
  function cronFromPreset(p) {
    const [h, m] = String(p.time || '09:00').split(':').map(Number), hm = `${m || 0} ${h || 0}`;
    switch (p.kind) {
      case 'daily': return `${hm} * * *`;
      case 'weekdays': return `${hm} * * 1-5`;
      case 'weekly': if (!(p.days || []).length) throw new Error('Pick at least one day.'); return `${hm} * * ${[...new Set(p.days.map(Number))].sort((a, b) => a - b).join(',')}`;
      case 'hours': return Number(p.every) > 1 ? `0 */${Number(p.every)} * * *` : '0 * * * *';
      case 'monthly': return `${hm} ${Number(p.dom) || 1} * *`;
      default: return String(p.cron || '').trim();
    }
  }
  function presetFromCron(cron) {
    const c = String(cron || '').trim().replace(/\s+/g, ' '), f = c.split(' '), time = /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) ? `${two(f[1])}:${two(f[0])}` : null;
    const out = f.length === 5 && f[3] === '*' && (
      (c === '0 * * * *' && { kind: 'hours', every: 1 }) || (/^0 \*\/\d+ \* \* \*$/.test(c) && { kind: 'hours', every: Number(f[1].slice(2)) }) ||
      (time && f[2] === '*' && f[4] === '*' && { kind: 'daily', time }) || (time && f[2] === '*' && f[4] === '1-5' && { kind: 'weekdays', time }) ||
      (time && f[2] === '*' && /^[0-6](,[0-6])*$/.test(f[4]) && { kind: 'weekly', time, days: f[4].split(',').map(Number) }) ||
      (time && /^\d+$/.test(f[2]) && f[4] === '*' && { kind: 'monthly', time, dom: Number(f[2]) }));
    return out && cronFromPreset(out) === c ? out : { kind: 'cron', cron: c };
  }

  g.HQW = { memoryItems, memoryText, parseHash, portrait, STYLES, styleOf, TONE, accent, boardGroups, sumUsage, kfmt, fuzzy, SWATCHES, swatchName, describeCron, cronFromPreset, presetFromCron };
})(globalThis);
