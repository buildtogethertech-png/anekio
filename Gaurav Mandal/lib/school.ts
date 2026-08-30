export const INVOICE_STYLES = [
  { id: "classic", label: "Classic", hint: "School name on top, clear bill table" },
  { id: "compact", label: "Compact", hint: "One page, tight, good for WhatsApp" },
  { id: "formal", label: "Formal", hint: "Affiliation, GSTIN, stamp and sign" },
] as const;

export type InvoiceStyle = (typeof INVOICE_STYLES)[number]["id"];

export type SchoolProfile = {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  affiliation: string;
  gstin: string;
  pan: string;
  upiId: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  signatory: string;
  logoPath: string;
  signPath: string;
  stampPath: string;
  invoiceStyle: InvoiceStyle;
  sessionStart: string;
  sessionEnd: string;
};

export const DEFAULT_SCHOOL: SchoolProfile = {
  name: "Anekio School",
  address: "12, Lake Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  phone: "080 4000 1200",
  email: "office@anekio.school",
  affiliation: "CBSE",
  gstin: "",
  pan: "",
  upiId: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  signatory: "Principal",
  logoPath: "",
  signPath: "",
  stampPath: "",
  invoiceStyle: "classic",
  sessionStart: "",
  sessionEnd: "",
};

export function schoolFromConfig(
  row?: (Partial<Omit<SchoolProfile, "invoiceStyle">> & { invoiceStyle?: string }) | null
): SchoolProfile {
  return {
    name: row?.name || DEFAULT_SCHOOL.name,
    address: row?.address || DEFAULT_SCHOOL.address,
    city: row?.city || DEFAULT_SCHOOL.city,
    state: row?.state || DEFAULT_SCHOOL.state,
    pincode: row?.pincode || DEFAULT_SCHOOL.pincode,
    phone: row?.phone || DEFAULT_SCHOOL.phone,
    email: row?.email || DEFAULT_SCHOOL.email,
    affiliation: row?.affiliation || DEFAULT_SCHOOL.affiliation,
    gstin: row?.gstin || "",
    pan: row?.pan || "",
    upiId: row?.upiId || "",
    bankName: row?.bankName || "",
    bankAccountName: row?.bankAccountName || "",
    bankAccountNumber: row?.bankAccountNumber || "",
    bankIfsc: row?.bankIfsc || "",
    signatory: row?.signatory || DEFAULT_SCHOOL.signatory,
    logoPath: row?.logoPath || "",
    signPath: row?.signPath || "",
    stampPath: row?.stampPath || "",
    invoiceStyle: INVOICE_STYLES.some((s) => s.id === row?.invoiceStyle)
      ? (row!.invoiceStyle as InvoiceStyle)
      : "classic",
    sessionStart: row?.sessionStart || defaultAcademicSession().sessionStart,
    sessionEnd: row?.sessionEnd || defaultAcademicSession().sessionEnd,
  };
}

/** CBSE-style session: 1 April to 31 March. */
export function defaultAcademicSession(asOf = new Date()) {
  const startYear = asOf.getMonth() >= 3 ? asOf.getFullYear() : asOf.getFullYear() - 1;
  return {
    sessionStart: `${startYear}-04-01`,
    sessionEnd: `${startYear + 1}-03-31`,
  };
}

export function parseSchoolDate(value?: string | null) {
  const s = (value || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(+d) ? null : d;
}

export function placeLines(row: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}) {
  const street = (row.address || "").trim();
  const place = [row.city, row.state, row.pincode].map((p) => (p || "").trim()).filter(Boolean).join(" ");
  return [street, place].filter(Boolean);
}

export function schoolLines(school: SchoolProfile) {
  return [
    ...placeLines(school),
    school.phone && `Tel ${school.phone}`,
    school.email,
  ].filter((v): v is string => Boolean(v));
}

export function schoolAssetUrl(rel?: string) {
  if (!rel) return "";
  return `/api/files/${rel}`;
}

export function schoolBankLine(school: SchoolProfile) {
  const parts = [
    school.bankName,
    school.bankAccountName,
    school.bankAccountNumber && `A/c ${school.bankAccountNumber}`,
    school.bankIfsc && `IFSC ${school.bankIfsc}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
