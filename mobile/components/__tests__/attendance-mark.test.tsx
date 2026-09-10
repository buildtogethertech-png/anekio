import { render, screen, within } from "@testing-library/react-native";
import { type AttendanceDot } from "../../lib/attendance-summary";
import { AttendanceDots } from "../attendance-mark";

jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});

const dots: AttendanceDot[] = [
  { date: "2026-08-19", weekday: "We", kind: "present", letter: "P" },
  { date: "2026-08-20", weekday: "Th", kind: "absent", letter: "A" },
  { date: "2026-08-21", weekday: "Fr", kind: "late", letter: "L" },
  { date: "2026-08-22", weekday: "Sa", kind: "leave", letter: "" },
  { date: "2026-08-24", weekday: "Mo", kind: "", letter: "" },
  { date: "2026-08-25", weekday: "Tu", kind: "present", letter: "P" },
  { date: "2026-08-26", weekday: "We", kind: "present", letter: "P" },
];

function classes(testId: string) {
  return screen.getByTestId(testId).props.className as string;
}

describe("AttendanceDots", () => {
  it("gives the desktop calendar larger, evenly spaced dots and a soft active cue", () => {
    render(<AttendanceDots dots={dots} activeDate="2026-08-26" />);

    expect(screen.getByLabelText("Last 7 days We P Th A Fr late Sa leave Tu P We P").props.className).toContain(
      "gap-2"
    );
    expect(classes("attendance-dot-2026-08-26")).toEqual(
      expect.stringContaining("h-7 w-7")
    );
    expect(screen.getByTestId("attendance-weekday-2026-08-26").props.className).toContain("text-[10px]");
    expect(within(screen.getByTestId("attendance-dot-2026-08-26")).getByText("P").props.className).toContain(
      "text-[11px]"
    );
    expect(classes("attendance-dot-2026-08-26")).toEqual(
      expect.stringContaining("border-2 border-clay-400")
    );
    expect(classes("attendance-dot-2026-08-26")).not.toContain("border-ink-900");
    expect(screen.getByTestId("attendance-weekday-2026-08-26").props.className).toContain("text-clay-600");
    expect(classes("attendance-dot-2026-08-19")).not.toContain("border-clay-400");
    expect(screen.getByTestId("attendance-weekday-2026-08-19").props.className).not.toContain("text-clay-600");
  });

  it("preserves the compact calendar footprint and legibility", () => {
    render(<AttendanceDots dots={dots} compact activeDate="2026-08-26" />);

    expect(screen.getByLabelText("Last 7 days We P Th A Fr late Sa leave Tu P We P").props.className).toContain(
      "gap-1.5"
    );
    expect(classes("attendance-dot-2026-08-26")).toContain("h-5 w-5");
    expect(within(screen.getByTestId("attendance-dot-2026-08-26")).getByText("P").props.className).toContain(
      "text-[9px]"
    );
  });

  it("retains every semantic status fill while applying the active cue independently", () => {
    render(<AttendanceDots dots={dots} activeDate="2026-08-19" />);

    expect(classes("attendance-dot-2026-08-19")).toContain("bg-emerald-600");
    expect(classes("attendance-dot-2026-08-20")).toContain("bg-red-600");
    expect(classes("attendance-dot-2026-08-21")).toContain("bg-amber-500");
    expect(classes("attendance-dot-2026-08-22")).toContain("bg-sky-600");
    expect(classes("attendance-dot-2026-08-24")).toContain("border border-ink-200 bg-ink-100");
    expect(classes("attendance-dot-2026-08-19")).toContain("border-2 border-clay-400");
  });

  it("uses only the clay border when an unmarked day is active", () => {
    render(<AttendanceDots dots={dots} activeDate="2026-08-24" />);

    expect(classes("attendance-dot-2026-08-24")).toContain("bg-ink-100");
    expect(classes("attendance-dot-2026-08-24")).toContain("border-2 border-clay-400");
    expect(classes("attendance-dot-2026-08-24")).not.toContain("border border-ink-200");
  });

  it.each([undefined, "2026-09-01"])(
    "renders a balanced history with no active treatment for activeDate %s",
    (activeDate) => {
      render(<AttendanceDots dots={dots} activeDate={activeDate} />);

      for (const dot of dots) {
        expect(classes(`attendance-dot-${dot.date}`)).not.toContain("border-clay-400");
        expect(classes(`attendance-dot-${dot.date}`)).not.toContain("border-ink-900");
        expect(screen.getByTestId(`attendance-weekday-${dot.date}`).props.className).not.toContain("text-clay-600");
      }
    }
  );
});

