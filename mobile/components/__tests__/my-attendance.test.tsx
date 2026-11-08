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
      day("2026-11-07", { inAt: "08:52", outAt: "15:10", inVia: "location", outVia: "location", minutes: 378, outs: [{ at: "13:00", via: "location" }, { at: "15:10", via: "location" }] }),
      day("2026-11-06", { status: "LATE", inAt: "09:12", outAt: "11:20", minutes: 128, lateMin: 12, early: "Not well" }),
      day("2026-11-05", { status: "LEAVE", note: "Sick" }),
      day("2026-11-04", { status: "PRESENT" }),
      day("2026-11-03", { status: "LATE", inAt: "16:57", lateMin: 477 }),
      day("2026-11-01", { status: "OFF", note: "Sunday off" }),
    ],
    summary: { present: 2, late: 1, early: 1, leave: 1, absent: 0, avgMinutes: 253 },
  } as never);
});

describe("MyAttendanceSheet", () => {
  it("shows the month summary and each day's status", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    expect(await screen.findByLabelText("2026-11-07 On time")).toBeTruthy();
    expect(screen.getAllByText("Left early")).toHaveLength(2);
    expect(screen.getByText("Sick")).toBeTruthy();
    expect(screen.getByText("Sunday off")).toBeTruthy();
    expect(screen.getByText("Average 4h 13m a day at school")).toBeTruthy();
    expect(screen.getByText(/Left early · Not well/)).toBeTruthy();
    expect(screen.getByText("Marked present by office")).toBeTruthy();
    expect(screen.getByText("Late 7h 57m")).toBeTruthy();
  });

  it("lists every out of a day when tapped", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    fireEvent.press(await screen.findByLabelText("2026-11-07 On time"));
    expect(screen.getByText("Out 1:00 PM")).toBeTruthy();
    expect(screen.getByText("Out 3:10 PM · counts")).toBeTruthy();
  });

  it("goes to the previous month", async () => {
    render(<MyAttendanceSheet open token="t" onClose={jest.fn()} />);
    await screen.findByLabelText("2026-11-07 On time");
    const first = (mockAct.mock.calls[0][2] as { month: string }).month;
    fireEvent.press(screen.getByLabelText("Previous month"));
    await waitFor(() => expect(mockAct).toHaveBeenCalledTimes(2));
    expect((mockAct.mock.calls[1][2] as { month: string }).month < first).toBe(true);
  });
});
