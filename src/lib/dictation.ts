/** Joins dictated text onto what is already typed, with sensible spacing and capitalisation. */
export function appendDictation(current: string, spoken: string): string {
  const piece = spoken.trim();
  if (!piece) return current;
  const base = current.replace(/\s+$/, "");
  const startsSentence = !base || /[.!?]$/.test(base);
  const cased = startsSentence ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece;
  return base ? `${base} ${cased}` : cased;
}
