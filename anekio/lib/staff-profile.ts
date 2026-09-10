import { ymd } from "./exams";

export const STAFF_FIRST_PASSWORD = "12345";

export type StaffAdmitValues = {
  name: string;
  phone: string;
  roleId: string;
  joinedOn: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
};

export function emptyStaffAdmit(roleId = ""): StaffAdmitValues {
  return {
    name: "",
    phone: "",
    roleId,
    joinedOn: todayJoinedOn(),
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  };
}

export function suggestedStaffRoleId(
  roles: { id: string; name: string; portal: string; isSystem?: boolean }[]
) {
  return (
    roles.find((r) => r.portal === "OFFICE" && r.name === "Fees")?.id ??
    roles.find((r) => r.portal === "OFFICE" && !r.isSystem)?.id ??
    roles[0]?.id ??
    ""
  );
}

export function todayJoinedOn() {
  return ymd(new Date());
}

export function requireJoinedOn(value?: string | null) {
  const joinedOn = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedOn)) throw new Error("Pick a joining date");
  return joinedOn;
}

export function placeFields(input: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}) {
  return {
    address: String(input.address || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    pincode: String(input.pincode || "").trim(),
  };
}

export function parseMonthlySalary(raw: unknown, fallback = 30000) {
  const n = Number(String(raw ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

export function formatJoinedHint(joinedOn?: string | null) {
  const [y, m, d] = String(joinedOn || "")
    .trim()
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (!y || !m || !d) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Joined ${d} ${months[m - 1]} ${y}`;
}
