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
 * Shares the receipt as a PDF file where the platform allows it (Android/iOS browsers that support
 * file sharing, so WhatsApp gets the PDF as an attachment). Otherwise shares the text with the PDF link,
 * or on desktop web opens the PDF so it can be downloaded.
 */
export async function shareReceiptPdf(url: string, fileName: string, text: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    try {
      // The receipt link opens the school's receipt page; attaching a file needs the PDF version.
      const fileUrl = /\/pay\/r\//.test(url) ? `${url}${url.includes("?") ? "&" : "?"}pdf=1` : url;
      const blob = await fetch(fileUrl).then((r) => {
        if (!r.ok) throw new Error("Receipt not ready");
        return r.blob();
      });
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text });
        return;
      }
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
    }
    if (nav.share) {
      await nav.share({ text, url }).catch(() => undefined);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Share.share({ message: text, url }).catch(() => undefined);
}
