import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { KioskTopButton, QrDockButton, StaffAttendanceQrButton } from "../staff-attendance-qr";
import { act as mutate } from "../../lib/mutate";
import { useOptionalRecord } from "../../lib/record";

const mockPush = jest.fn();
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock("../../lib/record", () => ({
  useRecord: jest.fn(),
  useOptionalRecord: jest.fn(),
}));
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
const mockUseOptionalRecord = useOptionalRecord as jest.MockedFunction<typeof useOptionalRecord>;
const originalOs = Platform.OS;

function setOs(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: os });
}

function stubWindowOpen() {
  const child = { opener: {} as unknown };
  const open = jest.fn(() => child);
  const originalOpen = window.open;
  const originalLocation = window.location;
  Object.defineProperty(window, "location", { configurable: true, value: { origin: "http://localhost:8081" } });
  window.open = open as unknown as typeof window.open;
  return {
    open,
    child,
    restore() {
      window.open = originalOpen;
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    },
  };
}

function mockToday(today: { marked: boolean; date: string; inAt?: string } | null) {
  const reloadSilently = jest.fn().mockResolvedValue(undefined);
  mockUseOptionalRecord.mockReturnValue({
    data: today ? { staffAttendanceSelf: { today } } : { staffAttendanceSelf: null },
    error: "",
    refreshing: false,
    setChildId: jest.fn(),
    reload: jest.fn(),
    reloadSilently,
  } as unknown as ReturnType<typeof useOptionalRecord>);
  return reloadSilently;
}

describe("teacher attendance QR", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockPush.mockReset();
    setOs(originalOs);
    mockToday({ marked: false, date: "2026-10-22", inAt: "" });
  });

  afterEach(() => {
    setOs(originalOs);
    jest.useRealTimers();
  });

  it("lets the teacher generate a QR before attendance is marked", async () => {
    mockAct.mockResolvedValue({
      ok: true,
      qrText: "anekio:staff-attendance:abc",
      qrDataUrl: "data:image/png;base64,xx",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      ttlSeconds: 120,
      person: { kind: "teacher", id: "t1", name: "Tara", employeeId: "T-1" },
    } as never);
    const onMessage = jest.fn();
    render(<StaffAttendanceQrButton token="tok" alreadyMarked={false} onMessage={onMessage} />);
    fireEvent.press(screen.getByRole("button", { name: "Show attendance QR" }));
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("tok", "generateStaffAttendanceQr"));
    expect(await screen.findByText("My attendance QR")).toBeTruthy();
  });

  it("disables the QR when attendance is already marked", () => {
    const onMessage = jest.fn();
    render(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: "Attendance already marked for today" })).toBeDisabled();
    expect(screen.getByText("Attendance already marked for today")).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });

  it("keeps the QR disabled after a refresh says it is marked", () => {
    const onMessage = jest.fn();
    const view = render(<StaffAttendanceQrButton token="tok" alreadyMarked={false} onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: "Show attendance QR" })).toBeEnabled();
    view.rerender(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: "Attendance already marked for today" })).toBeDisabled();
  });

  it("refetches server state on an interval", () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn();
    render(<StaffAttendanceQrButton token="tok" alreadyMarked={false} onRefresh={onRefresh} onMessage={jest.fn()} />);
    expect(onRefresh).toHaveBeenCalled();
    jest.advanceTimersByTime(15000);
    expect(onRefresh.mock.calls.length).toBeGreaterThan(1);
    jest.useRealTimers();
  });

  it("does not generate when the dashboard already has today's mark", async () => {
    render(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Attendance already marked for today" }));
    expect(mockAct).not.toHaveBeenCalled();
  });
});

describe("website admin scan button", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockPush.mockReset();
    setOs(originalOs);
  });

  afterEach(() => {
    setOs(originalOs);
  });

  it("hides the header scan icon without staff.attendance or staff.edit", () => {
    render(<KioskTopButton token="tok" permissions={["desk.view"]} />);
    expect(screen.queryByRole("button", { name: "Open staff check-in" })).toBeNull();
  });

  it("opens /staff/scan in a new tab on web and leaves this tab unchanged", () => {
    setOs("web");
    const stub = stubWindowOpen();
    render(<KioskTopButton token="tok" permissions={["staff.attendance"]} />);
    fireEvent.press(screen.getByRole("button", { name: "Open staff check-in" }));
    expect(stub.open).toHaveBeenCalledWith("http://localhost:8081/staff/scan", "_blank");
    expect(stub.child.opener).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText("Show your attendance QR")).toBeNull();
    stub.restore();
  });

  it("lets staff.edit open the scanner in a new web tab", () => {
    setOs("web");
    const stub = stubWindowOpen();
    render(<KioskTopButton token="tok" permissions={["staff.edit"]} />);
    fireEvent.press(screen.getByRole("button", { name: "Open staff check-in" }));
    expect(stub.open).toHaveBeenCalledWith("http://localhost:8081/staff/scan", "_blank");
    expect(mockPush).not.toHaveBeenCalled();
    stub.restore();
  });

  it("keeps the native camera kiosk on phone", () => {
    setOs("ios");
    const stub = stubWindowOpen();
    render(<KioskTopButton token="tok" permissions={["staff.edit"]} />);
    fireEvent.press(screen.getByRole("button", { name: "Open staff check-in" }));
    expect(stub.open).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Show your attendance QR")).toBeTruthy();
    stub.restore();
  });
});

describe("teacher QR dock freeze", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockPush.mockReset();
    mockToday({ marked: false, date: "2026-10-22", inAt: "" });
  });

  it("does not generate a new QR after today's attendance is marked", () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    render(<QrDockButton token="tok" hasSelfQr />);
    const button = screen.getByRole("button", { name: "Attendance already marked for today" });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(mockAct).not.toHaveBeenCalled();
  });

  it("shows a checked-in frozen state after check-in", () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    render(<QrDockButton token="tok" hasSelfQr />);
    expect(screen.getByRole("button", { name: "Attendance already marked for today" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Show my attendance QR" })).toBeNull();
  });

  it("lets QR generation work again the next calendar day", async () => {
    mockAct.mockResolvedValue({
      ok: true,
      qrText: "anekio:staff-attendance:next",
      qrDataUrl: "data:image/png;base64,xx",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      ttlSeconds: 120,
      person: { kind: "teacher", id: "t1", name: "Tara", employeeId: "T-1" },
    } as never);
    mockToday({ marked: true, date: "2026-10-21", inAt: "08:55" });
    const view = render(<QrDockButton token="tok" hasSelfQr />);
    expect(screen.getByRole("button", { name: "Attendance already marked for today" })).toBeDisabled();
    mockToday({ marked: false, date: "2026-10-22", inAt: "" });
    view.rerender(<QrDockButton token="tok" hasSelfQr />);
    fireEvent.press(screen.getByRole("button", { name: "Show my attendance QR" }));
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("tok", "generateStaffAttendanceQr"));
  });
});
