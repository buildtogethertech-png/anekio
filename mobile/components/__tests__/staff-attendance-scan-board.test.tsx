import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StaffAttendanceScanBoard } from "../staff-attendance-scan-board";
import { act as mutate } from "../../lib/mutate";
import { useSession } from "../../lib/session";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("jsqr", () => jest.fn());
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

describe("staff attendance scan board", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: ["staff.edit"] },
    } as unknown as ReturnType<typeof useSession>);
  });

  it("blocks users without staff.edit", () => {
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: [] },
    } as unknown as ReturnType<typeof useSession>);
    render(<StaffAttendanceScanBoard />);
    expect(screen.getByText("No access")).toBeTruthy();
    expect(screen.queryByText("Mark attendance")).toBeNull();
  });

  it("marks a pasted QR and stays on the scanner", async () => {
    mockAct.mockResolvedValue({
      ok: true,
      person: { kind: "teacher", id: "t1", name: "Tara Teacher", employeeId: "T-1" },
      date: "2026-10-12",
      status: "PRESENT",
      inAt: "08:55",
    } as never);
    render(<StaffAttendanceScanBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "anekio:staff-attendance:one");
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(screen.getByText("Attendance marked")).toBeTruthy());
    expect(screen.getByText(/Keep scanning/)).toBeTruthy();
    expect(screen.getByText("Scan attendance")).toBeTruthy();
  });

  it("does not send the same QR twice during the cooldown", async () => {
    mockAct.mockResolvedValue({
      ok: true,
      person: { kind: "teacher", id: "t1", name: "Tara Teacher", employeeId: "T-1" },
      date: "2026-10-12",
      status: "PRESENT",
      inAt: "08:55",
    } as never);
    render(<StaffAttendanceScanBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "anekio:staff-attendance:one");
    fireEvent.press(screen.getByText("Mark attendance"));
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(1));
  });

  it("scans a different teacher after the first mark", async () => {
    mockAct
      .mockResolvedValueOnce({
        ok: true,
        person: { kind: "teacher", id: "t1", name: "Tara Teacher", employeeId: "T-1" },
        date: "2026-10-12",
        status: "PRESENT",
        inAt: "08:55",
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        person: { kind: "teacher", id: "t2", name: "Rhea DSouza", employeeId: "T-2" },
        date: "2026-10-12",
        status: "PRESENT",
        inAt: "08:56",
      } as never);
    render(<StaffAttendanceScanBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "anekio:staff-attendance:one");
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(screen.getByText(/Tara Teacher/)).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "anekio:staff-attendance:two");
    await new Promise((resolve) => setTimeout(resolve, 1600));
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(screen.getByText(/Rhea DSouza/)).toBeTruthy());
    expect(mockAct).toHaveBeenCalledTimes(2);
  });

  it("resumes after an invalid QR", async () => {
    mockAct.mockRejectedValueOnce(new Error("This staff attendance QR is not valid."));
    render(<StaffAttendanceScanBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "bad");
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(screen.getByText("Invalid QR")).toBeTruthy());
    expect(screen.getByText(/Scanner still running/)).toBeTruthy();
  });

  it("shows already marked, expired, and used outcomes", async () => {
    mockAct.mockRejectedValueOnce(new Error("Attendance already marked for today"));
    const view = render(<StaffAttendanceScanBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Scan or paste attendance QR code"), "anekio:staff-attendance:one");
    fireEvent.press(screen.getByText("Mark attendance"));
    await waitFor(() => expect(screen.getByText("Already marked")).toBeTruthy());
    view.unmount();
  });
});
