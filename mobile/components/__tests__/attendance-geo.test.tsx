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

describe("MarkHereSheet", () => {
  it("one big Mark in, then You're in", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "", checkedOut: false, meters: 46, accuracy: 12 } as never);
    const onDone = jest.fn();
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={onDone} />);
    expect(screen.getByText("Ready to mark in?")).toBeTruthy();
    expect(screen.getByText("Mark in")).toBeTruthy();
    expect(screen.queryByText(/Secure/)).toBeNull();
    expect(screen.queryByLabelText("Mark out here")).toBeNull();
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText("You're in! 🎉")).toBeTruthy();
    expect(screen.getByText("Checked in at 8:52 AM. Have a great day.")).toBeTruthy();
    expect(screen.queryByText(/GPS ±/)).toBeNull();
    expect(screen.getByText(/Anekio SmartAttend/)).toBeTruthy();
    expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendanceHere", { lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    expect(onDone).toHaveBeenCalled();
  });

  it("shows what is happening while it marks", async () => {
    let found: (f: unknown) => void = () => undefined;
    mockReadFix.mockReturnValue(new Promise((r) => (found = r)) as never);
    let saved: (v: unknown) => void = () => undefined;
    mockAct.mockReturnValue(new Promise((r) => (saved = r)) as never);
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText("Marking you in…")).toBeTruthy();
    expect(screen.getByText("Finding your location")).toBeTruthy();
    expect(screen.getByTestId("mark-steps")).toBeTruthy();
    found({ lat: 28.6143, lng: 77.209, accuracy: 18, mocked: false });
    expect(await screen.findByText("Checking you're at school")).toBeTruthy();
    saved({ ok: true, inAt: "08:52", outAt: "", checkedOut: false });
    expect(await screen.findByText("You're in! 🎉")).toBeTruthy();
    expect(screen.queryByTestId("mark-steps")).toBeNull();
  });

  it("once in, the same middle button turns into Mark out", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "15:10", checkedOut: true } as never);
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("You're checked in")).toBeTruthy();
    expect(screen.getByText("Mark out")).toBeTruthy();
    expect(screen.getByText("Hours")).toBeTruthy();
    expect(screen.queryByLabelText("Mark in here")).toBeNull();
    fireEvent.press(screen.getByLabelText("Mark out here"));
    expect(await screen.findByText("Out at 3:10 PM")).toBeTruthy();
    expect(screen.getByText("6h 18m")).toBeTruthy();
  });

  it("a day with an out time reads Done for today, and the out can be updated", () => {
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52", outAt: "15:10" }} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(screen.getByText("Done for today")).toBeTruthy();
    expect(screen.getByText("In 8:52 AM · Out 3:10 PM. Leaving later? Tap again.")).toBeTruthy();
    expect(screen.getByText("Out again")).toBeTruthy();
    expect(screen.getByLabelText("Mark out here")).toBeTruthy();
  });

  it("after the tick, Mark in becomes Mark out in the same place", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "", checkedOut: false } as never);
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByTestId("attendance-done")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Mark out here")).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText("You're checked in")).toBeTruthy();
  }, 10000);

  it("lists earlier outs when out was marked more than once", () => {
    render(
      <MarkHereSheet
        open
        token="t"
        today={{ marked: true, inAt: "08:52", outAt: "17:05", outLog: [{ at: "13:00" }, { at: "17:05" }] }}
        onClose={jest.fn()}
        onDone={jest.fn()}
      />
    );
    expect(screen.getByTestId("earlier-outs").props.children).toBe("Earlier out 1:00 PM · the last one counts");
  });

  it("shows the server's reason and lets them try again", async () => {
    mockReadFix.mockResolvedValue({ lat: 28.62, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockRejectedValue(new Error("You are 680 m from school. Mark when you are inside (within 150 m)."));
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText(/680 m from school/)).toBeTruthy();
    expect(screen.getByText("Couldn't mark you")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("says what to do when location is not allowed", async () => {
    mockReadFix.mockRejectedValue(new Error("Allow location for Anekio to mark attendance here."));
    render(<MarkHereSheet open token="t" today={{ marked: false }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark in here"));
    expect(await screen.findByText(/Allow location/)).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });
});

describe("Leaving early and breaks", () => {
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

  it("Mark out before the day ends asks why, shows classes left, then goes home", async () => {
    teacherDay();
    const focus = phoneDay("focus");
    mockReadFix.mockResolvedValue({ lat: 28.6143, lng: 77.209, accuracy: 12, mocked: false });
    mockAct.mockResolvedValue({ ok: true, inAt: "08:52", outAt: "11:20", checkedOut: true } as never);
    render(<MarkHereSheet open token="t" today={{ marked: true, inAt: "08:52" }} onClose={jest.fn()} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Mark out here"));
    expect(screen.getByText("Leaving early?")).toBeTruthy();
    expect(screen.getByText("2-A Maths")).toBeTruthy();
    expect(screen.getByLabelText("Mark out and go home").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Not well"));
    fireEvent.press(screen.getByLabelText("Mark out and go home"));
    expect(await screen.findByText("Out at 11:20 AM")).toBeTruthy();
    expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendanceHere", expect.objectContaining({ earlyReason: "Not well" }));
    expect(focus.goHome).toHaveBeenCalledWith("Not well");
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
    expect(screen.getByText("2-A Maths is on now · after it")).toBeTruthy();
  });
});

describe("Attendance tile (location schools)", () => {
  it("opens the sheet from the quick action and shows when you are in", async () => {
    const { rerender } = render(<MarkHereButton tile token="t" today={{ marked: false }} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Attendance. Not marked yet"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
    rerender(<MarkHereButton tile token="t" today={{ marked: true, inAt: "08:52" }} onDone={jest.fn()} />);
    expect(screen.getByLabelText("Attendance. In at 8:52 AM")).toBeTruthy();
  });
});

describe("Header Mark in (office staff, location schools)", () => {
  it("is a small round button that opens the same sheet", async () => {
    render(<MarkHereButton icon token="t" today={{ marked: false }} onDone={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Attendance. Not marked yet"));
    expect(await screen.findByTestId("mark-here-sheet")).toBeTruthy();
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
