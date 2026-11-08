import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MyAttendanceSheet } from "../my-attendance";
import { act as mutate } from "../../lib/mutate";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const day = (date: string, extra: Record<string, unknown>) => ({
  date,
  status: "PRESENT",
  inAt: "",
  outAt: "",
  inVia: "",
  outVia: "",
  minutes: 0,
  lateMin: 0,
  early: "",
  note: "",
  outs: [],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAct.mockResolvedValue({
    ok: true,
    month: "2026-11",
    days: [
      day("2026-11-07", { inAt: "08:52", outAt: "15:10", inVia: "location", outVia: "location", minutes: 378, outs: [{ at: "13:00", via: "location" }, { at: "15:10", via: "location" }], breaks: [{ from: "12:00", to: "12:25", reason: "Lunch", minutes: 25 }] }),
      day("2026-11-06", { status: "LATE", inAt: "09:12", outAt: "11:20", minutes: 128, lateMin: 12, early: "Not well" }),
      day("2026-11-05", { status: "LEAVE", note: "Sick" }),
      day("2026-11-04", { status: "PRESENT" }),
      day("2026-11-03", { status: "LATE", inAt: "16:57", lateMin: 477 }),
      day("2026-11-01", { status: "OFF", note: "Sunday off" }),
    ],
    summary: { present: 2, late: 1, early: 1, leave: 1, absent: 0, avgMinutes: 253, breakMinutes: 25 },
  } as never);
});

describe("MyAttendanceSheet", () => {
  it("lists each day's In and Out, newest first, under this month's card", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    expect(await screen.findByText("8:52 AM")).toBeTruthy();
    expect(screen.getByText("3:10 PM")).toBeTruthy();
    expect(screen.getByText(/of \d+ school days present/)).toBeTruthy();
    expect(screen.getByLabelText("2026-11-07 On time")).toBeTruthy();
    expect(screen.getAllByText("Left early").length).toBeGreaterThan(1);
    expect(screen.getByText("Not well")).toBeTruthy();
    expect(screen.getByText("by 7h 57m")).toBeTruthy();
    expect(screen.getByText("Marked present by office")).toBeTruthy();
    expect(screen.getByText("Sunday off")).toBeTruthy();
  });

  it("shows how many breaks and how long, per day and for the month (no break details)", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByText("8:52 AM");
    expect(screen.getByText("☕ 1 · 25m")).toBeTruthy();
    expect(screen.getByText("☕ 1 break · 25m this month")).toBeTruthy();
    expect(screen.queryByText("Lunch")).toBeNull();
    expect(screen.queryByTestId("month-grid")).toBeNull();
  });

  it("scrolling to the end loads the month before", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByText("8:52 AM");
    mockAct.mockResolvedValueOnce({
      ok: true,
      month: "2026-10",
      days: [day("2026-10-31", { inAt: "08:40", outAt: "14:30", minutes: 350 })],
      summary: { present: 1, late: 0, early: 0, leave: 0, absent: 0, avgMinutes: 350 },
    } as never);
    fireEvent(screen.getByTestId("attendance-list"), "onEndReached");
    expect(await screen.findByText("8:40 AM")).toBeTruthy();
    expect(screen.getByText(/October 2026/i)).toBeTruthy();
    expect((mockAct.mock.calls[1][2] as { month: string }).month).toBe("2026-10");
  });
});
