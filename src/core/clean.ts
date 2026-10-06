/**
 * Clean-verbatim pass: removes stutters and filler without changing meaning.
 * Deliberately conservative: anything that would need judgement (misheard
 * names, garbled phrases) is left to the Claude line-fix stage, which is
 * instructed never to invent content.
 */
export interface Replacement {
  find: string;
  replace: string;
  /** Treat `find` as a regex (flags "g" added). Default: literal. */
  regex?: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyReplacements(t: string, reps: Replacement[] = []): string {
  for (const r of reps) {
    const re = r.regex ? new RegExp(r.find, "g") : new RegExp(escapeRe(r.find), "g");
    t = t.replace(re, r.replace);
  }
  return t;
}

export function cleanVerbatim(input: string, reps: Replacement[] = []): string {
  let t = applyReplacements(input, reps);
  // filler phrases
  t = t.replace(/,?\s*\b(you know|I mean)\b,?/gi, " ");
  // "kind of" as filler, but keep "what kind of X", "the kind of", "kind of a"
  t = t.replace(
    /(?<!\bthe )(?<!\bwhat )(?<!\bthis )(?<!\bthat )(?<!\bone )(?<!\bany )\bkind of\s+(?!an? )/gi,
    "",
  );
  // repeated 2-3 word phrases ("a lot of, a lot of")
  t = t.replace(/\b((?:\w+'?\w*\s){1,2}\w+'?\w*)(,?\s+\1\b)+/gi, "$1");
  // repeated single words ("the the")
  t = t.replace(/\b(\w+'?\w*)(,?\s+\1\b)+/gi, "$1");
  t = t.replace(/,\s*,/g, ",");
  t = t.replace(/\s+([,.?!])/g, "$1");
  t = t.replace(/\s{2,}/g, " ").trim();
  // capitalise after sentence end, and the first letter
  t = t.replace(/([.?!]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}
