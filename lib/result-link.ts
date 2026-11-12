import { createHmac, timingSafeEqual } from "crypto";
import { publicOrigin } from "./utils";

/**
 * Shareable link to one student's result for one exam: /result/<studentId>.<seriesId>.<signature>.
 * Signed, so it needs no stored token and cannot be edited to open another student's result.
 */
function secret() {
  const s = process.env.JWT_SECRET || process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("JWT_SECRET is missing");
  return s;
}

function sign(studentId: string, seriesId: string) {
  return createHmac("sha256", secret()).update(`result:${studentId}:${seriesId}`).digest("base64url").slice(0, 22);
}

export function resultToken(studentId: string, seriesId: string) {
  return `${studentId}.${seriesId}.${sign(studentId, seriesId)}`;
}

export function readResultToken(token: string) {
  const [studentId, seriesId, signature, extra] = String(token || "").split(".");
  if (!studentId || !seriesId || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(studentId, seriesId));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { studentId, seriesId };
}

export function resultLink(studentId: string, seriesId: string) {
  return `${publicOrigin()}/result/${resultToken(studentId, seriesId)}`;
}
