import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StaffTimesheet } from "../staff-timesheet";
import { act as mutate } from "../../lib/mutate";
import { ymd } from "../../lib/calendar";
import { DEFAULT_PAYROLL_RULES } from "../../lib/payroll";

jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const today = ymd(new Date());
const everyDay = { weekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] };

function tara(days: { date: string; status: string; inAt?: string; outAt?: string }[]) {
  return [{ kind: "teacher", id: "t1", name: "Tara Teacher", days }] as never;
}

beforeEach(() => jest.clearAllMocks());

describe("StaffTimesheet out time", () => {
  it("shows the out time under the in time", () => {
    render(
      <StaffTimesheet staff={tara([{ date: today, status: "PRESENT", inAt: "08:20", outAt: "15:10" }])} calendar={everyDay} rules={DEFAULT_PAYROLL_RULES} token="t" canEdit onBack={jest.fn()} onSaved={jest.fn()} />
    );
    expect(screen.getAllByText("08:20").length).toBeGreaterThan(1);
    expect(screen.getByLabelText("Out 15:10")).toBeTruthy();
  });

  it("lets the office set the out time", async () => {
    mockAct.mockResolvedValue({ ok: true } as never);
    const onSaved = jest.fn().mockResolvedValue(undefined);
    render(<StaffTimesheet staff={tara([{ date: today, status: "PRESENT", inAt: "08:20" }])} calendar={everyDay} rules={DEFAULT_PAYROLL_RULES} token="t" canEdit onBack={jest.fn()} onSaved={onSaved} />);
    fireEvent.press(screen.getByLabelText("Edit Tara Teacher in times"));
    fireEvent.changeText(screen.getByLabelText("Out time"), "15.30");
    fireEvent.press(screen.getByText("Save times"));
    await waitFor(() =>
      expect(mockAct).toHaveBeenCalledWith("t", "markStaffAttendance", {
        date: today,
        rows: [{ kind: "teacher", id: "t1", status: "PRESENT", inAt: "08:20", outAt: "15:30", clear: false }],
      })
    );
  });

  it("refuses an out time before the in time", async () => {
    render(<StaffTimesheet staff={tara([{ date: today, status: "PRESENT", inAt: "08:20" }])} calendar={everyDay} rules={DEFAULT_PAYROLL_RULES} token="t" canEdit onBack={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.press(screen.getByLabelText("Edit Tara Teacher in times"));
    fireEvent.changeText(screen.getByLabelText("Out time"), "07:00");
    fireEvent.press(screen.getByText("Save times"));
    expect(await screen.findByText("Out time must be after In time.")).toBeTruthy();
    expect(mockAct).not.toHaveBeenCalled();
  });
});
