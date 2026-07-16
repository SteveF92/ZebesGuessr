/** Difficulty stars for a rating. Clamped to 0–5 so an off-band rating can
 *  never throw on `String.repeat`. */
export function Stars({ rating }: { rating: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="rating-stars">
      {'★'.repeat(r)}
      {'☆'.repeat(5 - r)}
    </span>
  );
}
