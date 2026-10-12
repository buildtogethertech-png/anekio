import {
  barcodeDetectorAvailable,
  cameraConstraints,
  classifyScanMessage,
  shouldIgnoreScan,
  STAFF_SCAN_COOLDOWN_MS,
  videoIsReady,
} from "../staff-attendance-scan";

describe("staff attendance scan helpers", () => {
  it("prefers BarcodeDetector when the constructor exists", () => {
    expect(barcodeDetectorAvailable({ BarcodeDetector: function Detector() {} })).toBe(true);
    expect(barcodeDetectorAvailable({})).toBe(false);
  });

  it("starts decoding only after the video has frames", () => {
    expect(videoIsReady({ readyState: 1, videoWidth: 640, videoHeight: 480 })).toBe(false);
    expect(videoIsReady({ readyState: 2, videoWidth: 0, videoHeight: 480 })).toBe(false);
    expect(videoIsReady({ readyState: 2, videoWidth: 640, videoHeight: 480 })).toBe(true);
  });

  it("asks for the rear camera", () => {
    expect(cameraConstraints()).toEqual({ video: { facingMode: { ideal: "environment" } }, audio: false });
  });

  it("ignores the same QR during the cooldown and while a request is in flight", () => {
    expect(
      shouldIgnoreScan({ code: "anekio:staff-attendance:a", now: 2000, lastCode: "anekio:staff-attendance:a", lastAt: 1000, inFlight: false })
    ).toBe(true);
    expect(
      shouldIgnoreScan({
        code: "anekio:staff-attendance:a",
        now: 1000 + STAFF_SCAN_COOLDOWN_MS + 1,
        lastCode: "anekio:staff-attendance:a",
        lastAt: 1000,
        inFlight: false,
      })
    ).toBe(false);
    expect(
      shouldIgnoreScan({ code: "anekio:staff-attendance:b", now: 1100, lastCode: "anekio:staff-attendance:a", lastAt: 1000, inFlight: true })
    ).toBe(true);
  });

  it("lets a different teacher QR through after one success", () => {
    expect(
      shouldIgnoreScan({ code: "anekio:staff-attendance:b", now: 1100, lastCode: "anekio:staff-attendance:a", lastAt: 1000, inFlight: false })
    ).toBe(false);
  });

  it("classifies API errors for the scanner", () => {
    expect(classifyScanMessage("Attendance already marked for today")).toMatchObject({ kind: "already" });
    expect(classifyScanMessage("This staff attendance QR was already used.")).toMatchObject({ kind: "used" });
    expect(classifyScanMessage("This staff attendance QR has expired.")).toMatchObject({ kind: "expired" });
    expect(classifyScanMessage("This staff attendance QR is not valid.")).toMatchObject({ kind: "invalid" });
    expect(classifyScanMessage("Camera permission denied")).toMatchObject({ kind: "denied" });
  });
});
