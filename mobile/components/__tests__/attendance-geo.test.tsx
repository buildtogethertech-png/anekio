import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { MarkHereSheet, StaffAttendanceSettings } from "../attendance-geo";
import { QrDockButton } from "../staff-attendance-qr";
import { act as mutate } from "../../lib/mutate";
import { readFix } from "../../lib/attendance-geo";
import { useOptionalRecord } from "../../lib/record";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/attendance-geo", () => ({
  ...jest.requireActual("../../lib/attendance-geo"),
  readFix: jest.fn(),
}));
jest.mock("expo-location", () => ({}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn(), useOptionalRecord: jest.fn() }));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockReadFix = readFix as jest.MockedFunction<typeof readFix>;
const mockUseOptionalRecord = useOptionalRecord as jest.MockedFunction<typeof useOptionalRecord>;
const SCHOOL = { qr: true, location: true, lat: 28.6139, lng: 77.209, radiusM: 150 };
const originalOs = Platform.OS;

function setOs(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: os });
}

beforeEach(() => {
  jest.clearAllMocks();
  setOs("android");
});
afterAll(() => setOs(originalOs));

describe("MarkHereSheet", () => {
  it("marks the entry with the phone's location", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "", checkedOut: false } as never);
    const onDone = jest.fn();
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={onDone} />);
    expect(screen.getByText("Not marked yet today")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText("In at 8:52 AM")).toBeTruthy();
    expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendanceHere", { lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the exit once checked in, and the server's reason when refused", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.62, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockRejectedValue(new Error("You are 680 m from school. Mark when you are inside (within 150 m)."));
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("Checked in today at 8:52 AM")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Mark out here"));
    expect(await screen.findByText(/680 m from school/)).toBeTruthy();
    expect(screen.getByText("Not marked")).toBeTruthy();
  });

  it("says what to do when location is not allowed", async () => {
    mockReadFix.mockRejectedValue(new Error("Allow location for Anekio to mark attendance here."));
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText(/Allow location/)).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });
});

describe("QrDockButton follows Settings → Staff attendance", () => {
  function withSetup(setup: { qr: boolean; location: boolean }, extra: Record<string, unknown> = {}) {
    mockUseOptionalRecord.mockReturnValue({
      data: { staffAttendanceSelf: { today: { date: "2026-11-06", marked: false }, attendanceSetup: { ...SCHOOL, ...setup } }, ...extra },
      reloadSilently: jest.fn().mockResolvedValue(undefined),
      reloadInBackground: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useOptionalRecord>);
  }

  it("opens Mark here when location is on, with QR as the other way", async () => {
    withSetup({ qr: true, location: true });
    render(<QrDockButton token="t" />);
    fireEvent.press(screen.getByLabelText("Mark my attendance. Not marked yet"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    expect(screen.getByLabelText("Use QR instead")).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });

  it("location only: no QR anywhere", async () => {
    withSetup({ qr: false, location: true });
    render(<QrDockButton token="t" />);
    fireEvent.press(screen.getByLabelText("Mark my attendance. Not marked yet"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    expect(screen.queryByLabelText("Use QR instead")).toBeNull();
  });

  it("QR only: never asks for location", async () => {
    withSetup({ qr: true, location: false });
    mockAct.mockResolvedValue({ ok: true, qrText: "x", qrDataUrl: "", expiresAt: new Date(Date.now() + 60_000).toISOString(), ttlSeconds: 60, person: {} } as never);
    render(<QrDockButton token="t" />);
    fireEvent.press(screen.getByLabelText("Show my attendance QR"));
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("t", "generateStaffAttendanceQr"));
    expect(mockReadFix).not.toHaveBeenCalled();
  });

  it("both off: no button", () => {
    withSetup({ qr: false, location: false });
    render(<QrDockButton token="t" canScan />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StaffAttendanceSettings", () => {
  const QR_ONLY = { qr: true, location: false, lat: 0, lng: 0, radiusM: 150 };

  it("lists every way, with RFID and fingerprint not ready yet", () => {
    render(<StaffAttendanceSettings token="t" setup={QR_ONLY} canEdit onSaved={jest.fn()} />);
    expect(screen.getByText("QR code")).toBeTruthy();
    expect(screen.getByText("Location")).toBeTruthy();
    expect(screen.getByText("RFID card")).toBeTruthy();
    expect(screen.getByText("Fingerprint")).toBeTruthy();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(screen.queryByText("School point")).toBeNull();
  });

  it("turning location on asks for the school point, then saves it with the distance", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6139, lng: 77.209, accuracy: 9, mocked: false });
    mockAct.mockResolvedValue({ ok: true } as never);
    const onSaved = jest.fn();
    render(<StaffAttendanceSettings token="t" setup={QR_ONLY} canEdit onSaved={onSaved} />);
    fireEvent.press(screen.getAllByRole("switch")[1]);
    expect(screen.getByText(/Not set/)).toBeTruthy();
    expect(screen.getByText("Set the school point to save")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Use my current location"));
    expect(await screen.findByText("School point taken (±9 m)")).toBeTruthy();
    fireEvent.press(screen.getByText("200 m"));
    fireEvent.press(screen.getAllByRole("switch")[0]);
    fireEvent.press(screen.getByLabelText("Save staff attendance"));
    await waitFor(() =>
      expect(mockAct).toHaveBeenCalledWith("t", "saveStaffAttendanceSetup", { qr: false, location: true, lat: 28.6139, lng: 77.209, radiusM: 200 })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("Test here tells how far the phone is and whether marking works", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6184, lng: 77.209, accuracy: 10, mocked: false });
    render(<StaffAttendanceSettings token="t" setup={SCHOOL} canEdit onSaved={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Test here"));
    expect(await screen.findByText(/^5\d\d m from the school point$/)).toBeTruthy();
    expect(screen.getByText(/marking would be refused here/)).toBeTruthy();
  });
});
