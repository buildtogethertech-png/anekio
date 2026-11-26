import type { PickedFile } from "./upload";

/** What the attach sheet picked: a photo just taken, or which picker to open. */
export type AttachSource = { kind: "photo"; file: PickedFile } | { kind: "photos" } | { kind: "files" };
type Sheet = (opts: { files: boolean }) => Promise<AttachSource | null>;
let sheet: Sheet | null = null;

/** AttachSheetHost (mounted once in the root layout) registers itself here. */
export function registerAttachSheet(open: Sheet | null) {
  sheet = open;
}

/** Camera / Gallery (/ File) sheet. Without the host (tests, before mount) it goes straight to the picker. */
export function chooseAttachSource(opts: { files: boolean }): Promise<AttachSource | null> {
  return sheet ? sheet(opts) : Promise.resolve({ kind: opts.files ? "files" : "photos" });
}
