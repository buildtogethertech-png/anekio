import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { MarkHereButton, MarkHereSheet, StaffAttendanceSettings } from "../attendance-geo";
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
const SCHOOL = { qr: false, location: true, lat: 28.6139, lng: 77.209, radiusM: 150 };
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

  it("a second tap right after check-in is a gentle note, not an error", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockRejectedValue(new Error("You checked in at 08:52. Mark again when leaving."));
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark out here"));
    expect(await screen.findByText("Already in at 8:52 AM")).toBeTruthy();
    expect(screen.queryByText("Not marked")).toBeNull();
  });

  it("says what to do when location is not allowed", async () => {
    mockReadFix.mockRejectedValue(new Error("Allow location for Anekio to mark attendance here."));
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText(/Allow location/)).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });
});

describe("Mark in tile (location schools)", () => {
  it("opens Mark here from the quick action, and says Mark out once in", async () => {
    const { rerender } = render(<MarkHereButton tile token="t" today={{ marked: false }} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    rerender(<MarkHereButton tile token="t" today={{ marked: true, inAt: "08:52" }} onDone={jest.fn()} />);
    expect(screen.getByLabelText("Mark out")).toBeTruthy();
  });
});

describe("Header dock", () => {
  function withSetup(setup: { qr: boolean; location: boolean }) {
    mockUseOptionalRecord.mockReturnValue({
      data: { staffAttendanceSelf: { today: { date: "2026-11-06", marked: false }, attendanceSetup: { ...SCHOOL, ...setup } }, staffAttendanceSetup: { ...SCHOOL, ...setup } },
      reloadSilently: jest.fn().mockResolvedValue(undefined),
      reloadInBackground: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useOptionalRecord>);
  }

  it("keeps only the office scan desk, and only for QR schools", () => {
    withSetup({ qr: true, location: false });
    const { unmount } = render(<QrDockButton token="t" hasSelfQr={false} canScan />);
    expect(screen.getByLabelText("Scan staff attendance")).toBeTruthy();
    unmount();
    withSetup({ qr: false, location: true });
    render(<QrDockButton token="t" hasSelfQr={false} canScan />);
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

  it("picks one way: choosing location asks for the school point and turns QR off", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6139, lng: 77.209, accuracy: 9, mocked: false });
    mockAct.mockResolvedValue({ ok: true } as never);
    const onSaved = jest.fn();
    render(<StaffAttendanceSettings token="t" setup={QR_ONLY} canEdit onSaved={onSaved} />);
    expect(screen.getByRole("radio", { name: "QR code" }).props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByRole("radio", { name: "Location" }));
    expect(screen.getByRole("radio", { name: "QR code" }).props.accessibilityState.checked).toBe(false);
    expect(screen.getByText(/Not set/)).toBeTruthy();
    expect(screen.getByText("Set the school point to save")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Use my current location"));
    expect(await screen.findByText("School point taken (±9 m)")).toBeTruthy();
    fireEvent.press(screen.getByText("200 m"));
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
