/** Pure helpers for the ad hoc invoice form (kept out of the component so tests need no RN). */
export function whole(text: string) {
  const n = Number(String(text).replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Adds up the form the same way the API does, so the total shown is the total saved. */
export function adhocTotals(lines: { label: string; qty: string; rate: string }[], discountText: string) {
  let subtotal = 0;
  let error = "";
  const filled = lines.filter((line) => line.label.trim() || line.rate.trim());
  for (const line of filled) {
    const qty = whole(line.qty || "1");
    const rate = whole(line.rate);
    if (!line.label.trim()) error ||= "Every item needs a name";
    else if (!Number.isInteger(qty) || qty < 1 || qty > 1000) error ||= `Quantity for "${line.label.trim()}" must be 1 to 1000`;
    else if (!Number.isFinite(rate) || rate <= 0) error ||= `Enter a price for "${line.label.trim()}"`;
    else subtotal += qty * Math.round(rate);
  }
  const discount = discountText.trim() ? Math.max(0, Math.round(whole(discountText) || 0)) : 0;
  if (!filled.length) error ||= "Add at least one item";
  if (!error && discount >= subtotal) error = "Discount must be less than the total";
  return { subtotal, discount, total: Math.max(0, subtotal - discount), error, count: filled.length };
}
