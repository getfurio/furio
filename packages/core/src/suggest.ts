export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Longer values get no suggestion: nobody mistypes that much, and comparing them is slow. */
const MAX_SUGGESTED_LENGTH = 100;

/** The closest candidate, if it is close enough to be a plausible typo. */
export function closest(value: string, candidates: Iterable<string>): string | undefined {
  if (value.length > MAX_SUGGESTED_LENGTH) return undefined;
  const max = Math.max(2, Math.floor(value.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    // The distance is at least the difference in length: too far already, skip the comparison.
    if (Math.abs(candidate.length - value.length) > max) continue;
    const distance = levenshtein(value, candidate);
    if (distance < bestDistance && distance <= max) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
