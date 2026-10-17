import {
  barcodeDetectorAvailable,
  cameraConstraints,
  classifyScanMessage,
  isStaffScanPath,
  openStaffScanRoute,
  shouldIgnoreScan,
  staffScanHref,
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

  it("opens the dedicated scan route in this app on phone", () => {
    const push = jest.fn();
    openStaffScanRoute({ push });
    expect(push).toHaveBeenCalledWith("/staff/scan");
    expect(push).toHaveBeenCalledTimes(1);
    expect(isStaffScanPath("/staff/scan")).toBe(true);
    expect(isStaffScanPath("/staff")).toBe(false);
  });

  it("opens the camera scanner in a new browser tab only", () => {
    const push = jest.fn();
    const child = { opener: {} as unknown };
    const open = jest.fn(() => child);
    openStaffScanRoute(
      { push },
      { newTab: true, win: { open, location: { origin: "http://localhost:8081" } } }
    );
    expect(open).toHaveBeenCalledWith("http://localhost:8081/staff/scan", "_blank");
    expect(child.opener).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(staffScanHref("http://localhost:8081/")).toBe("http://localhost:8081/staff/scan");
  });

  it("does not open the camera in this tab when the new-tab handle is empty", () => {
    const push = jest.fn();
    openStaffScanRoute(
      { push },
      { newTab: true, win: { open: () => null, location: { origin: "http://localhost:8081" } } }
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("classifies API errors for the scanner", () => {
    expect(classifyScanMessage("Attendance already marked for today")).toMatchObject({ kind: "already" });
    expect(classifyScanMessage("This staff attendance QR was already used.")).toMatchObject({ kind: "used" });
    expect(classifyScanMessage("This staff attendance QR has expired.")).toMatchObject({ kind: "expired" });
    expect(classifyScanMessage("This staff attendance QR is not valid.")).toMatchObject({ kind: "invalid" });
    expect(classifyScanMessage("Camera permission denied")).toMatchObject({ kind: "denied" });
  });
});
