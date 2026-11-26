import { Alert, Platform } from "react-native";

const mockGetDocument = jest.fn();
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocument(...args) }));
const mockTakePhoto = jest.fn();
jest.mock("../photo-capture", () => ({ takePhoto: () => mockTakePhoto() }));
jest.mock("../api", () => ({ apiBase: () => "http://test" }));

import { nativeMimeTypes, pickFile } from "../upload";

type Button = { text: string; onPress?: () => void };
function answer(text: string) {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => {
    (buttons as Button[]).find((b) => b.text === text)?.onPress?.();
  });
}

beforeEach(() => {
  Platform.OS = "android";
  mockGetDocument.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: "file:///a.jpg", name: "a.jpg", mimeType: "image/jpeg" }] });
  mockTakePhoto.mockReset().mockResolvedValue({ uri: "file:///cam.jpg", name: "photo.jpg", type: "image/jpeg" });
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

  it("a photo field asks Take photo / Choose photo; Take photo opens the camera", async () => {
    answer("Take photo");
    expect(await pickFile("image/png,image/jpeg,image/webp")).toMatchObject({ uri: "file:///cam.jpg" });
    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it("Choose photo opens the picker on images only", async () => {
    answer("Photos");
    await pickFile("image/png,image/jpeg,application/pdf,.pdf");
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["image/png", "image/jpeg"] }));
  });

  it("Files keeps PDFs too", async () => {
    answer("Files");
    await pickFile("image/png,application/pdf,.pdf");
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["image/png", "application/pdf"] }));
  });

  it("Cancel picks nothing", async () => {
    answer("Cancel");
    expect(await pickFile("image/png,image/jpeg")).toBeNull();
    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(mockTakePhoto).not.toHaveBeenCalled();
  });

  it("CSV import goes straight to files, with no photo question", async () => {
    const alert = jest.spyOn(Alert, "alert");
    await pickFile(".csv,text/csv,text/plain");
    expect(alert).not.toHaveBeenCalled();
    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ type: ["text/csv", "text/plain"] }));
  });
});
