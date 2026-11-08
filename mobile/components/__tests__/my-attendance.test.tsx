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
  it("shows the month card and opens on the latest day", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    expect(await screen.findByTestId("day-card")).toBeTruthy();
    expect(screen.getByText("Saturday, 7 November")).toBeTruthy();
    expect(screen.getByText("On time")).toBeTruthy();
    expect(screen.getByText("6h 18m at school")).toBeTruthy();
    expect(screen.getByText(/of \d+ school days present/)).toBeTruthy();
    expect(screen.queryByText("By office")).toBeNull();
  });

  it("the day card shows breaks and every out", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByTestId("day-card");
    expect(screen.getByText("Lunch")).toBeTruthy();
    expect(screen.getByText("12:00 PM – 12:25 PM")).toBeTruthy();
    expect(screen.getByText("Checked out 2 times")).toBeTruthy();
    expect(screen.getByText("3:10 PM · counts")).toBeTruthy();
  });

  it("tapping another day in the calendar shows that day", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByTestId("day-card");
    fireEvent.press(screen.getByLabelText("2026-11-06 Left early"));
    expect(screen.getByText("Left early · Not well")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("2026-11-04 On time"));
    expect(screen.getByText("Marked present by the office.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("2026-11-03 Late 7h 57m"));
    expect(screen.getAllByText("Late 7h 57m").length).toBeGreaterThan(0);
  });

  it("hides breaks under a minute and folds a long list", async () => {
    mockAct.mockResolvedValueOnce({
      ok: true,
      month: "2026-11",
      days: [
        day("2026-11-07", {
          inAt: "08:52",
          breaks: [
            { from: "09:00", to: "09:00", reason: "", minutes: 0 },
            ...[1, 2, 3, 4].map((n) => ({ from: `1${n}:00`, to: `1${n}:10`, reason: `Free period ${n}`, minutes: 10 })),
          ],
        }),
      ],
      summary: { present: 1, late: 0, early: 0, leave: 0, absent: 0, avgMinutes: 0 },
    } as never);
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByTestId("day-card");
    expect(screen.getByText("Free period 3")).toBeTruthy();
    expect(screen.queryByText("Free period 4")).toBeNull();
    fireEvent.press(screen.getByText("Show all 4"));
    expect(screen.getByText("Free period 4")).toBeTruthy();
  });

  it("goes to the previous month", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByTestId("day-card");
    const first = (mockAct.mock.calls[0][2] as { month: string }).month;
    fireEvent.press(screen.getByLabelText("Previous month"));
    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(2));
    expect((mockAct.mock.calls[1][2] as { month: string }).month < first).toBe(true);
  });
});
