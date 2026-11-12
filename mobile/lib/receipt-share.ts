import { Linking, Platform, Share } from "react-native";
import { webOrigin } from "./api";
import { act } from "./mutate";

/** Public receipt PDF for one or more paid invoices of the same student. */
export async function receiptPdfUrl(token: string | null, invoiceIds: string[]) {
  const tokens: string[] = [];
  for (const invoiceId of invoiceIds) {
    const res = await act<{ ok: true; token: string }>(token, "ensurePayToken", { invoiceId });
    if (res.token) tokens.push(encodeURIComponent(res.token));
  }
  if (!tokens.length) throw new Error("Could not make the receipt link.");
  return `${webOrigin()}/pay/receipt/${tokens.join(",")}`;
}

export function receiptMessage(input: {
  studentName: string;
  amount: string;
  range?: string;
  method?: string;
  when?: string;
  receiptNo?: string;
  utr?: string;
  url?: string;
}) {
  return [
    "Dear Parent,",
    "",
    `We have received ${input.amount} towards the school fee for ${input.studentName}${input.range ? ` (${input.range})` : ""}.`,
    "",
    input.receiptNo ? `Receipt No: ${input.receiptNo}` : "",
    input.utr && input.utr !== input.receiptNo ? `UTR / Ref: ${input.utr}` : "",
    input.method ? `Mode: ${input.method}` : "",
    input.when ? `Date: ${input.when}` : "",
    input.url ? `\nView / download receipt: ${input.url}` : "",
    "",
    "Thank you.",
  ]
    .filter((line, i, all) => line !== "" || (all[i - 1] ?? "") !== "")
    .join("\n");
}

export async function sendReceiptOnWhatsApp(waDigits: string, text: string) {
  await Linking.openURL(`https://wa.me/${waDigits}?text=${encodeURIComponent(text)}`);
}

/**
 * Share the receipt as a message with its link (no file): the link opens the school's receipt page,
 * which has Download PDF. Phone: the share sheet. Web: the browser share sheet, else copy to clipboard,
 * else open the link.
 */
export async function shareReceiptPdf(url: string, _fileName: string, text: string): Promise<"shared" | "copied" | "opened"> {
  const message = text.includes(url) ? text : `${text}\n${url}`;
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    if (navigator.share) {
      await navigator.share({ text: message }).catch(() => undefined);
      return "shared";
    }
    try {
      await navigator.clipboard.writeText(message);
      return "copied";
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      return "opened";
    }
  }
  await Share.share({ message }).catch(() => undefined);
  return "shared";
}
