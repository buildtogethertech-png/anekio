import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { MarkHereButton, MarkHereSheet, StaffAttendanceSettings } from "../attendance-geo";
import { QrDockButton } from "../staff-attendance-qr";
import { act as mutate } from "../../lib/mutate";
import { readFix } from "../../lib/attendance-geo";
import { useOptionalRecord } from "../../lib/record";
import { useFocusDay } from "../../lib/class-focus";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/attendance-geo", () => {
  const readFix = jest.fn();
  return {
    ...jest.requireActual("../../lib/attendance-geo"),
    readFix,
    createFixWatcher: () => ({ start: () => Promise.resolve(), best: () => null, since: () => 0, subscribe: () => () => undefined, stop: () => undefined }),
    waitForFix: (_w: unknown, onProgress?: (f: unknown) => void) =>
      readFix().then((f: unknown) => {
        onProgress?.(f);
        return f;
      }),
  };
});
jest.mock("expo-location", () => ({}));
jest.mock("../../lib/class-focus", () => ({
  ...jest.requireActual("../../lib/class-focus"),
  useFocusDay: jest.fn(() => null),
}));
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
const mockUseFocusDay = useFocusDay as jest.MockedFunction<typeof useFocusDay>;
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

describe("Check in from the tile", () => {
  it("not checked in: the tile opens the sheet, and Check in there checks in", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "", checkedOut: false } as never);
    const onDone = jest.fn();
    render(<MarkHereButton tile token="t" today={{ marked: false }} onDone={onDone} />);
    expect(screen.getByText("Check in")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("My check in. Not checked in yet"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Check in here"));
    expect(await screen.findByText("Checked in at 8:52 AM")).toBeTruthy();
    expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendanceHere", { lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    expect(onDone).toHaveBeenCalled();
  });

  it("a refusal shows the server's reason in the sheet", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.62, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockRejectedValue(new Error("You are 5 km from school. Mark when you are inside (within 150 m)."));
    render(<MarkHereButton tile token="t" today={{ marked: false }} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("My check in. Not checked in yet"));
    fireEvent.press(await screen.findByLabelText("Check in here"));
    expect(await screen.findByText(/5 km from school/)).toBeTruthy();
  });

  it("once in, a tap opens the sheet; the header button works the same", async () => {
    const { rerender } = render(<MarkHereButton tile token="t" today={{ marked: true, inAt: "08:52" }} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("My check in. In at 8:52 AM"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    rerender(<MarkHereButton icon token="t" today={{ marked: true, inAt: "08:52" }} onDone={jest.fn()} />);
    expect(screen.getByLabelText("My check in. In at 8:52 AM")).toBeTruthy();
  });
});

describe("MarkHereSheet", () => {
  // A teacher with one more class later today; the school day ends at 23:59.
  function teacherDay() {
    const later = new Date(Date.now() + 60 * 60_000);
    const hh = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const end = new Date(later.getTime() + 40 * 60_000);
    const js = later.getDay();
    mockUseOptionalRecord.mockReturnValue({
      data: {
        kind: "TEACHER",
        schoolDay: { enabled: true, endsAt: "23:59" },
        staffAttendanceSelf: { name: "Kavita Joshi" },
        timetable: {
          periods: [{ id: "p5", name: "P5", start: hh(later), end: hh(end) }],
          slots: [{ weekday: js === 0 ? 7 : js, periodId: "p5", period: "P5", classLabel: "2-A", subject: "Maths" }],
        },
      },
    } as unknown as ReturnType<typeof useOptionalRecord>);
  }

  function phoneDay(status: "focus" | "break", extra: Record<string, unknown> = {}) {
    const focus = {
      enabled: true,
      day: { status, since: Date.now() - 65_000, breakReason: status === "break" ? "Lunch" : undefined },
      now: Date.now(),
      inClass: null,
      breakInClass: false,
      reasons: ["Free period", "Lunch", "Other"],
      guardAllowed: true,
      allowGuard: jest.fn(),
      takeBreak: jest.fn(),
      resume: jest.fn(),
      goHome: jest.fn(),
      ...extra,
    };
    mockUseFocusDay.mockReturnValue(focus as never);
    return focus;
  }

  afterEach(() => {
    mockUseFocusDay.mockReturnValue(null);
    mockUseOptionalRecord.mockReset();
  });

  it("shows In / Out / Hours and checks out (after school hours: no questions)", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "15:10", checkedOut: true } as never);
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("You're checked in")).toBeTruthy();
    expect(screen.getByText("Hours")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Check out here"));
    expect(await screen.findByText("Checked out at 3:10 PM")).toBeTruthy();
  });

  it("a day with an out time reads Done for today, and can check out again", () => {
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52", outAt: "15:10" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("Done for today")).toBeTruthy();
    expect(screen.getByText("In 8:52 AM · Out 3:10 PM")).toBeTruthy();
    expect(screen.getByText("Check out again")).toBeTruthy();
  });

  it("shows the server's reason when it refuses", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.62, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockRejectedValue(new Error("Weak GPS signal. Step near a window or outside and try again."));
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Check out here"));
    expect(await screen.findByText(/Weak GPS signal/)).toBeTruthy();
  });

  it("Check out before the day ends asks why, shows classes left, then goes home", async () => {
    teacherDay();
    const focus = phoneDay("focus");
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "11:20", checkedOut: true } as never);
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Check out here"));
    expect(screen.getByText("Going home early?")).toBeTruthy();
    expect(screen.getByText("2-A Maths")).toBeTruthy();
    expect(screen.getByLabelText("Check out and go home").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Not well"));
    fireEvent.press(screen.getByLabelText("Check out and go home"));
    expect(await screen.findByText("Checked out at 11:20 AM")).toBeTruthy();
    expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendanceHere", expect.objectContaining({ earlyReason: "Not well" }));
    expect(focus.goHome).toHaveBeenCalledWith("Not well");
  });

  it("one tile says Break / Out, and the sheet has Break and Check out side by side", async () => {
    teacherDay();
    phoneDay("focus");
    render(<MarkHereButton tile token="t" today={{ marked: true, inAt: "08:52" }} onDone={jest.fn()} />);
    expect(screen.getByText("Break / Out")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("My check in. In at 8:52 AM"));
    expect(await screen.findByLabelText("Take a break")).toBeTruthy();
    expect(screen.getByLabelText("Check out here")).toBeTruthy();
  });

  it("Take a break needs a reason; on break, Resume is right there", () => {
    teacherDay();
    const focus = phoneDay("focus");
    const { rerender } = render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Take a break"));
    fireEvent.press(screen.getByLabelText("Lunch"));
    fireEvent.press(screen.getByLabelText("Start break"));
    expect(focus.takeBreak).toHaveBeenCalledWith("Lunch");

    const onBreak = phoneDay("break");
    rerender(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("On break · Lunch")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Resume"));
    expect(onBreak.resume).toHaveBeenCalled();
  });

  it("no break while a class is on (unless the school allows it)", () => {
    teacherDay();
    phoneDay("focus", { inClass: { classLabel: "2-A", subject: "Maths" } });
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByLabelText("Take a break").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("2-A Maths is on now · break after it")).toBeTruthy();
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
