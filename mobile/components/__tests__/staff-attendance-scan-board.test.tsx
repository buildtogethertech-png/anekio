import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { StaffAttendanceScanBoard } from "../staff-attendance-scan-board";
import { act as mutate } from "../../lib/mutate";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

const mockReplace = jest.fn();
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn(), useOptionalRecord: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: mockReplace }) }));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock("jsqr", () => jest.fn());
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockReload = jest.fn().mockResolvedValue(undefined);
const originalOs = Platform.OS;

function setOs(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: os });
}

function session(permissions: string[]) {
  mockUseSession.mockReturnValue({ token: "office-token", user: { permissions } } as unknown as ReturnType<typeof useSession>);
}

function typeCode(code: string) {
  fireEvent.changeText(screen.getByLabelText("QR code"), code);
  fireEvent.press(screen.getByRole("button", { name: "Mark from code" }));
}

const tara = { kind: "teacher", id: "t1", name: "Tara Teacher", employeeId: "T-1" };

describe("staff attendance scan page", () => {
  beforeEach(() => {
    mockAct.mockReset();
    mockReload.mockClear();
    mockReplace.mockClear();
    mockUseRecord.mockReturnValue({ reload: mockReload } as unknown as ReturnType<typeof useRecord>);
    session(["staff.edit"]);
    setOs("web");
  });

  afterEach(() => setOs(originalOs));

  it("blocks users without staff.attendance or staff.edit", () => {
    session(["desk.view"]);
    render(<StaffAttendanceScanBoard />);
    expect(screen.getByText("No access")).toBeTruthy();
    expect(screen.queryByText("Staff check-in")).toBeNull();
  });

  it("shows the same check-in desk as the phone for staff.attendance", () => {
    session(["staff.attendance"]);
    render(<StaffAttendanceScanBoard />);
    expect(screen.getByText("Staff check-in")).toBeTruthy();
    expect(screen.getByText("Show your attendance QR")).toBeTruthy();
    expect(screen.queryByText("No access")).toBeNull();
  });

  it("marks a typed or pasted code (USB scanner) and refreshes the record", async () => {
    mockAct.mockResolvedValue({ ok: true, person: tara, date: "2026-11-06", status: "PRESENT", inAt: "08:52" } as never);
    render(<StaffAttendanceScanBoard />);
    typeCode("anekio:staff-attendance:abc");
    await waitFor(() => expect(mockAct).toHaveBeenCalledWith("office-token", "scanStaffAttendanceQr", { code: "anekio:staff-attendance:abc" }));
    expect(await screen.findByText("Welcome, Tara")).toBeTruthy();
    expect(mockReload).toHaveBeenCalled();
  });

  it("says bye with in and out on a check-out scan", async () => {
    mockAct.mockResolvedValue({ ok: true, person: tara, date: "2026-11-06", status: "PRESENT", inAt: "08:52", outAt: "15:10", checkedOut: true } as never);
    render(<StaffAttendanceScanBoard />);
    typeCode("anekio:staff-attendance:out");
    expect(await screen.findByText("Bye, Tara")).toBeTruthy();
    expect(screen.getAllByText("In 08:52 · Out 15:10 · T-1").length).toBeGreaterThan(0);
  });

  it("does not send the same code twice within a few seconds", async () => {
    mockAct.mockResolvedValue({ ok: true, person: tara, date: "2026-11-06", status: "PRESENT", inAt: "08:52" } as never);
    render(<StaffAttendanceScanBoard />);
    typeCode("anekio:staff-attendance:same");
    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(1));
    typeCode("anekio:staff-attendance:same");
    await waitFor(() => expect(screen.getByLabelText("QR code").props.value).toBe(""));
    expect(mockAct).toHaveBeenCalledTimes(1);
  });

  it("shows the error and keeps scanning", async () => {
    mockAct.mockRejectedValueOnce(new Error("This staff attendance QR has expired."));
    mockAct.mockResolvedValueOnce({ ok: true, person: tara, date: "2026-11-06", status: "PRESENT", inAt: "08:52" } as never);
    render(<StaffAttendanceScanBoard />);
    typeCode("anekio:staff-attendance:old");
    expect((await screen.findAllByText("Not marked")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("This staff attendance QR has expired.").length).toBeGreaterThan(0);
    typeCode("anekio:staff-attendance:new");
    expect(await screen.findByText("Welcome, Tara")).toBeTruthy();
  });

  it("Exit goes back to Employees", () => {
    render(<StaffAttendanceScanBoard />);
    fireEvent.press(screen.getByLabelText("Exit check-in"));
    expect(mockReplace).toHaveBeenCalledWith("/staff");
  });
});
