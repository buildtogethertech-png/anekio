/** Indian mobile as 10 digits, or empty if it is not a number. */
export function normalizeMobile(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return "";
}

/** Parents, teachers, and staff must have a real 10-digit mobile. */
export function requireMobile(raw: string, who = "this person") {
  const mobile = normalizeMobile(raw || "");
  if (!mobile) throw new Error(`Enter a 10-digit mobile number for ${who}.`);
  return mobile;
}

export function looksLikeEmail(raw: string) {
  return raw.includes("@");
}
