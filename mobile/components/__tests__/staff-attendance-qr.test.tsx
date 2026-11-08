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
const outQr = {
  ok: true,
  qrText: "anekio:staff-attendance:out",
  qrDataUrl: "data:image/png;base64,xx",
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  ttlSeconds: 120,
  checkedInAt: "08:55",
  checkedOutAt: "",
  person: { kind: "teacher", id: "t1", name: "Tara", employeeId: "T-1" },
};

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

function mockToday(today: { marked: boolean; date: string; inAt?: string; outAt?: string } | null) {
  const reloadSilently = jest.fn().mockResolvedValue(undefined);
  mockUseOptionalRecord.mockReturnValue({
    data: today ? { staffAttendanceSelf: { today } } : { staffAttendanceSelf: null },
    error: "",
    refreshing: false,
    setChildId: jest.fn(),
    reload: jest.fn(),
    reloadSilently,
    reloadInBackground: jest.fn().mockResolvedValue(undefined),
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

  it("turns into a check-out QR once attendance is marked", async () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    mockAct.mockResolvedValue(outQr as never);
    render(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={jest.fn()} />);
    expect(screen.getByText("Checked in today at 8:55 AM")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Show check-out QR" }));
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("tok", "generateStaffAttendanceQr"));
    expect(await screen.findByText("Scan when you leave. Your last scan is your out time.")).toBeTruthy();
  });

  it("closes the QR once the check-in scan lands", async () => {
    mockAct.mockResolvedValue({ ...outQr, checkedInAt: "" } as never);
    const view = render(<StaffAttendanceQrButton token="tok" alreadyMarked={false} onMessage={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Show attendance QR" }));
    expect(await screen.findByText("My attendance QR")).toBeTruthy();
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    view.rerender(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={jest.fn()} />);
    await waitFor(() => expect(screen.queryByText("My attendance QR")).toBeNull());
  });

  it("shows in and out once there is an exit scan", () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55", outAt: "15:10" });
    render(<StaffAttendanceQrButton token="tok" alreadyMarked onMessage={jest.fn()} />);
    expect(screen.getByText("In 8:55 AM · Out 3:10 PM")).toBeTruthy();
  });

  it("refreshes in the background every 30 s, not on mount (RecordProvider already loaded)", () => {
    jest.useFakeTimers();
    const onRefresh = jest.fn();
    render(<StaffAttendanceQrButton token="tok" alreadyMarked={false} onRefresh={onRefresh} onMessage={jest.fn()} />);
    expect(onRefresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15000);
    expect(onRefresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
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

describe("teacher QR dock", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockPush.mockReset();
    mockToday({ marked: false, date: "2026-10-22", inAt: "" });
  });

  it("offers the check-out QR after today's check-in", async () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    mockAct.mockResolvedValue(outQr as never);
    render(<QrDockButton token="tok" hasSelfQr />);
    const button = screen.getByRole("button", { name: "Show my check-out QR. Checked in today at 8:55 AM" });
    expect(button).toBeEnabled();
    fireEvent.press(button);
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("tok", "generateStaffAttendanceQr"));
    expect(await screen.findByText("Check-out QR")).toBeTruthy();
  });

  it("closes the check-out QR when the out time changes", async () => {
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55" });
    mockAct.mockResolvedValue(outQr as never);
    const view = render(<QrDockButton token="tok" hasSelfQr />);
    fireEvent.press(screen.getByRole("button", { name: "Show my check-out QR. Checked in today at 8:55 AM" }));
    expect(await screen.findByText("Check-out QR")).toBeTruthy();
    mockToday({ marked: true, date: "2026-10-22", inAt: "08:55", outAt: "15:10" });
    view.rerender(<QrDockButton token="tok" hasSelfQr />);
    await waitFor(() => expect(screen.queryByText("Check-out QR")).toBeNull());
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
    expect(screen.getByRole("button", { name: /check-out QR/ })).toBeTruthy();
    mockToday({ marked: false, date: "2026-10-22", inAt: "" });
    view.rerender(<QrDockButton token="tok" hasSelfQr />);
    fireEvent.press(screen.getByRole("button", { name: "Show my attendance QR" }));
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("tok", "generateStaffAttendanceQr"));
  });
});
