// Pure text helpers shared by prepare.mjs and tests: spoken→source mapping, LaTeX→plain text, caption splitting.

export const PAUSE_RE = /<#[^<>]*?#>/g;
const SOUND_TAG_RE = /\((?:breath|emm|chuckle)\)/g;
export const normalizeSpoken = (s) => s.replace(PAUSE_RE, '').replace(SOUND_TAG_RE, '').replace(/\s/g, '');
export const cleanSpoken = (s) => s.replace(PAUSE_RE, '').replace(SOUND_TAG_RE, '').trim();

const SYMBOLS = {
  mid: '|', vert: '|', cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', gt: '>', lt: '<',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', Longrightarrow: '⟹', implies: '⟹', Leftrightarrow: '⇔', iff: '⟺', neg: '¬',
  land: '∧', lor: '∨', cap: '∩', cup: '∪', in: '∈', subset: '⊂', forall: '∀', exists: '∃', partial: '∂',
  sum: '∑', prod: '∏', int: '∫', ldots: '…', cdots: '⋯', dots: '…', prime: '′', R: 'ℝ',
  ast: '*', star: '⋆', circ: '∘', mapsto: '↦', lvert: '|', rvert: '|', downarrow: '↓', uparrow: '↑',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π',
  sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
};
const SUB = {0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', n: 'ₙ', i: 'ᵢ', a: 'ₐ', e: 'ₑ', x: 'ₓ'};
const SUP = {0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', n: 'ⁿ', p: 'ᵖ', x: 'ˣ'};
const BLACKBOARD = {R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ'};
const IGNORED = new Set(['big', 'Big', 'bigg', 'Bigg', 'left', 'right', 'displaystyle', 'begin', 'end']);
const RELATIONS = /\s*([=+<>≤≥≠≈⟹⇒⇔⟺→−])\s*/g;

// Plain-text rendering of a TeX fragment for captions and tables. Unknown commands keep their name.
export function latexToText(src) {
  let s = src.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/\\(begin|end)\{[a-z*]+\}/g, '');
  let i = 0;
  const group = () => {
    let out = '';
    while (i < s.length) {
      const ch = s[i];
      if (ch === '}') { i++; return out; }
      if (ch === '{') { i++; out += group(); continue; }
      if (ch === '^' || ch === '_') {
        i++; const arg = s[i] === '{' ? (i++, group()) : s[i++] ?? '';
        const table = ch === '_' ? SUB : SUP;
        out += [...arg].every((c) => table[c]) ? [...arg].map((c) => table[c]).join('') : `${ch}${arg.length > 1 ? `(${arg})` : arg}`;
        continue;
      }
      if (ch === '\\') {
        i++; let name = '';
        while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++];
        if (!name) { const sym = s[i++]; out += sym === '\\' ? '\n' : '{}|$%&_#'.includes(sym) ? sym : ' '; continue; }
        if (name === 'overline' || name === 'bar') {
          const arg = (s[i] === '{' ? (i++, group()) : s[i++]).trim();
          // A combining bar only reads well over a single plain letter; nested or long negations use ¬(…).
          out += [...arg].length === 1 ? arg + '\u0305' : `¬(${arg})`; continue;
        }
        if (name === 'mathbb') { const a = (s[i] === '{' ? (i++, group()) : s[i++]).trim(); out += [...a].map((ch) => BLACKBOARD[ch] ?? ch).join(''); continue; }
        if (name === 'left' || name === 'right') { if (s[i] === '.') i++; continue; }
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const a = (i++, group()).trim(), b = (i++, group()).trim(), wrap = (v) => (/^(\d+(\.\d+)?|[A-Za-z])$/.test(v) ? v : `(${v})`);
          out += `${wrap(a)}/${wrap(b)}`; continue;
        }
        if (name === 'sqrt') { const a = s[i] === '{' ? (i++, group()) : s[i++]; out += `√${a.length > 1 ? `(${a})` : a}`; continue; }
        if (['text', 'mathrm', 'operatorname', 'textbf', 'mathbf', 'mathit', 't', 'op', 'boxed'].includes(name)) { if (s[i] === '{') { i++; out += group(); } continue; }
        if (name === 'c' || name === 'm') { if (s[i] === '{') { i++; group(); } continue; }
        if (name === 'quad' || name === 'qquad') { out += ' '; continue; }
        if (IGNORED.has(name)) { if ((name === 'begin' || name === 'end') && s[i] === '{') { i++; group(); } continue; }
        out += SYMBOLS[name] ?? name; continue;
      }
      if (ch === '&') { i++; continue; }
      out += ch === '-' ? '−' : ch; i++;
    }
    return out;
  };
  return group().split('\n').map((line) => line.replace(/\s+/g, ' ').replace(RELATIONS, ' $1 ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*\|\s*/g, '|').replace(/([∂∫√])\s+/g, '$1').replace(/\s+/g, ' ').trim()).filter(Boolean).join('；');
}

// Display text of a replaced source fragment, e.g. "1. $P(A \mid C)$" → "1. P(A|C)".
export function sourceDisplay(sourceText) {
  return sourceText.replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, (m) => latexToText(m)).replace(/\s+/g, ' ').trim();
}

const width = (ch) => (/[\u0300-\u036f]/.test(ch) ? 0 : /[\x00-\x7f₀-₉⁰-⁹]/.test(ch) ? 0.55 : 1);
export const displayWidth = (s) => [...s].reduce((a, c) => a + width(c), 0);
const unitsWidth = (us) => us.reduce((a, u) => a + displayWidth(u.text), 0);
const SENTENCE_END = /[。！？；!?]$/, CLAUSE_END = /[，、：,:；]$/;

// Glue Latin words and numbers so a caption never breaks inside "Logic" or "1946".
function groupWords(units) {
  const out = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    if (prev && !u.atomic && !prev.atomic && /^[A-Za-z0-9.'’-]+$/.test(u.text) && /[A-Za-z0-9.'’-]$/.test(prev.text)) out[out.length - 1] = {...prev, text: prev.text + u.text, weight: prev.weight + u.weight};
    else out.push(u);
  }
  return out;
}

// Balanced recursive split: clause marks first; a piece up to hardWidth is only cut at a clause mark.
// Without a word segmenter, forced cuts prefer positions after common function words.
const SOFT_END = /[的了是和与把将在从对就都也而或及并即被为让]$|\s$/;
function splitBalanced(us, maxWidth, hardWidth) {
  const total = unitsWidth(us);
  if (total <= maxWidth || us.length < 2) return [us];
  let best = -1, bestCost = Infinity, left = 0;
  for (let i = 0; i < us.length - 1; i++) {
    left += displayWidth(us[i].text);
    const right = total - left;
    if (left < 3 || right < 3) continue;
    const clause = CLAUSE_END.test(us[i].text);
    if (!clause && total <= hardWidth) continue;
    const opens = /[（“《(\["]$/.test(us[i].text) || /^[）”》)\]，。、：；？！"]/.test(us[i + 1].text.trimStart());
    const cost = (clause ? 0 : opens ? 3 : SOFT_END.test(us[i].text) ? 0.6 : 1) + Math.abs(left - right) / total;
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  if (best < 0) return [us];
  return [...splitBalanced(us.slice(0, best + 1), maxWidth, hardWidth), ...splitBalanced(us.slice(best + 1), maxWidth, hardWidth)];
}

// Units: [{text, weight, atomic}] in spoken order. Returns [{text, from, to}] with weight fractions in [0, 1].
export function splitUnits(units, maxWidth = 24, hardWidth = Math.round(maxWidth * 4 / 3)) {
  const grouped = groupWords(units), total = grouped.reduce((a, u) => a + u.weight, 0) || 1;
  const sentences = []; let cur = [];
  for (const u of grouped) { cur.push(u); if (SENTENCE_END.test(u.text)) { sentences.push(cur); cur = []; } }
  if (cur.length) sentences.push(cur);
  const chunks = []; let seen = 0;
  for (const piece of sentences.flatMap((s) => splitBalanced(s, maxWidth, hardWidth))) {
    const w = piece.reduce((a, u) => a + u.weight, 0);
    const text = piece.map((u) => u.text).join('').trim().replace(/[，。、；：,;]+$/u, '');
    if (text) chunks.push({text, from: seen / total, to: (seen + w) / total});
    else if (chunks.length) chunks[chunks.length - 1].to = (seen + w) / total;
    seen += w;
  }
  if (chunks.length) chunks[chunks.length - 1].to = 1;
  return chunks;
}

// Split "1. $a$ 2. $b$" or an aligned block into per-line source pieces.
function sourcePieces(sourceText) {
  const aligned = sourceText.match(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/);
  if (aligned) return aligned[1].split(/\\\\/).map((l) => l.trim()).filter(Boolean).map((l) => `$${l}$`);
  const re = /(\d+[.)]\s*)?(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g, pieces = [];
  let m, last = 0;
  while ((m = re.exec(sourceText))) {
    if (sourceText.slice(last, m.index).trim()) return [sourceText];
    pieces.push(m[0]); last = re.lastIndex;
  }
  return sourceText.slice(last).trim() || !pieces.length ? [sourceText] : pieces;
}

// Replacement segments covering several formulas are split when spoken lines match one-to-one.
export function expandSegments(segments) {
  return segments.flatMap((seg) => {
    if (seg.kind === 'literal') return [seg];
    const src = sourcePieces(seg.sourceText);
    const spoken = seg.ttsText.split(/<#[^<>]*?#>|\n+/).filter((p) => normalizeSpoken(p));
    if (src.length < 2 || src.length !== spoken.length) return [seg];
    let at = seg.ttsNormalizedRange[0];
    const subs = src.map((sourceText, k) => {
      const len = normalizeSpoken(spoken[k]).length, sub = {...seg, sourceText, ttsText: spoken[k], ttsNormalizedRange: [at, at + len]};
      at += len; return sub;
    });
    return at === seg.ttsNormalizedRange[1] ? subs : [seg];
  });
}

// Map one service sentence (normalized spoken range starting at rangeStart) to display units.
// Short formulas are restored from the source and repeated in every sentence that reads them;
// long or multi-line ones fall back to the spoken words of that sentence.
export function sentenceUnits(rawText, rangeStart, segments, options = {}) {
  const {maxFormulaWidth = 30} = options;
  const units = [], shownUnit = new Map(), fallbackSegs = new Set();
  let p = rangeStart;
  const segAt = (pos) => segments.find((s) => pos >= s.ttsNormalizedRange[0] && pos < s.ttsNormalizedRange[1]);
  for (const ch of cleanSpoken(rawText)) {
    if (/\s/.test(ch)) { units.push({text: ' ', weight: 0}); continue; }
    const seg = segAt(p++);
    if (!seg || seg.kind === 'literal') { units.push({text: ch, weight: 1}); continue; }
    const shown = sourceDisplay(seg.sourceText);
    if (displayWidth(shown) > maxFormulaWidth || /；/.test(shown)) { fallbackSegs.add(seg); units.push({text: ch, weight: 1}); continue; }
    if (shownUnit.has(seg)) { shownUnit.get(seg).weight++; continue; }
    const unit = {text: ` ${shown} `, weight: 1, atomic: true};
    shownUnit.set(seg, unit); units.push(unit);
  }
  return {units: tidy(units), spokenFallback: fallbackSegs.size, fallbackSources: [...fallbackSegs].map((s) => s.sourceText)};
}

// One space between Latin/formula runs and CJK, none at edges or next to CJK punctuation.
function tidy(units) {
  const out = [];
  for (const u of units) {
    const prev = out[out.length - 1];
    let text = u.text;
    if (/^\s/.test(text) && (!prev || /[\s（“《，。：；？！、]$/.test(prev.text))) text = text.replace(/^\s+/, '');
    if (prev && /^[，。：；？！、）”》]/.test(text)) prev.text = prev.text.replace(/\s+$/, '');
    if (!text) { if (prev) prev.weight += u.weight; continue; }
    out.push({...u, text});
  }
  return out;
}
