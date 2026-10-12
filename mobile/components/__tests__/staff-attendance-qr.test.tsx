import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StaffAttendanceQrButton } from "../staff-attendance-qr";
import { act as mutate } from "../../lib/mutate";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;

describe("teacher attendance QR", () => {
  beforeEach(() => {
    mockAct.mockReset();
  });

  it("lets the teacher generate a QR before attendance is marked", async () => {
    mockAct.mockResolvedValue({
      ok: true,
      qrText: "anekio:staff-attendance:abc",
      qrDataUrl: "data:image/png;base64,xx",
      expiresAt: new Date().toISOString(),
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
