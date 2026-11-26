import { Platform } from "react-native";

const mockGetDocument = jest.fn();
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocument(...args) }));
const mockChoose = jest.fn();
jest.mock("../photo-capture", () => ({ chooseAttachSource: (o: unknown) => mockChoose(o) }));
jest.mock("../api", () => ({ apiBase: () => "http://test" }));

import { nativeMimeTypes, pickFile } from "../upload";

const CAM = { uri: "file:///cam.jpg", name: "photo.jpg", type: "image/jpeg" };
function answer(text: string) {
  mockChoose.mockResolvedValueOnce(
    text === "Camera" ? { kind: "photo", file: CAM } : text === "Gallery" ? { kind: "photos" } : text === "File" ? { kind: "files" } : null
  );
}

beforeEach(() => {
  Platform.OS = "android";
  mockGetDocument.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: "file:///a.jpg", name: "a.jpg", mimeType: "image/jpeg" }] });
  mockChoose.mockReset();
});

describe("phone file picker", () => {
  it("gives Android a list of types, never one comma string, and turns extensions into types", () => {
    expect(nativeMimeTypes("image/png,image/jpeg,image/webp")).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(nativeMimeTypes("application/pdf,.pdf")).toEqual(["application/pdf"]);
    expect(nativeMimeTypes(".csv,.xlsx,text/csv")).toEqual([
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    expect(nativeMimeTypes("")).toEqual(["*/*"]);
  });

  it("a photo field opens the attach sheet (no File tile); Camera returns the photo", async () => {
    answer("Camera");
    expect(await pickFile("image/png,image/jpeg,image/webp")).toMatchObject({ uri: "file:///cam.jpg" });
    expect(mockChoose).toHaveBeenCalledWith({ files: false });
    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it("Gallery opens the picker on images only", async () => {
    answer("Gallery");
    await pickFile("image/png,image/jpeg,application/pdf,.pdf");
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["image/png", "image/jpeg"] }));
  });

  it("File keeps PDFs too", async () => {
    answer("File");
    await pickFile("image/png,application/pdf,.pdf");
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["image/png", "application/pdf"] }));
  });

  it("Cancel picks nothing", async () => {
    answer("Cancel");
    expect(await pickFile("image/png,image/jpeg")).toBeNull();
    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it("CSV import goes straight to files, with no photo question", async () => {
    await pickFile(".csv,text/csv,text/plain");
    expect(mockChoose).not.toHaveBeenCalled();
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["text/csv", "text/plain"] }));
  });
});
