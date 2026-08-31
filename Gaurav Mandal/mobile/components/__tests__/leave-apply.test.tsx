import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeaveApplyCard } from "../leave-apply";
import { act as mutate } from "../../lib/mutate";
import { useRecord } from "../../lib/record";

jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn() }));
jest.mock("../date-field", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    DateField({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder?: string }) {
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={placeholder || "Pick a date"} onPress={() => onChange(value || "2026-09-01")}>
          <Text>{value || placeholder}</Text>
        </Pressable>
      );
    },
  };
});
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, {
    get(target, property) {
      if (property === "useWindowDimensions") {
        return () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 });
      }
      return Reflect.get(target, property);
    },
  });
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;

describe("LeaveApplyCard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-01T06:00:00.000Z"));
    mockAct.mockResolvedValue({ ok: true } as never);
    mockUseRecord.mockReturnValue({
      data: {
        leaveTypes: [
          {
            id: "planned",
            name: "Planned",
            forTeacher: true,
            forStaff: true,
            forStudent: true,
            eligibilityGender: "ANY",
            noticeDays: 0,
            yearlyCap: 12,
          },
        ],
        myLeave: [],
        calendar: { weekdays: [1, 2, 3, 4, 5, 6], holidays: [] },
      },
      error: "",
      refreshing: false,
      reload: jest.fn(),
      setChildId: jest.fn(),
    } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("submits teacher leave through the write endpoint payload", async () => {
    const onDone = jest.fn();
    const onError = jest.fn();
    render(<LeaveApplyCard audience="teacher" token="teacher-token" onDone={onDone} onError={onError} />);

    fireEvent.press(screen.getByRole("button", { name: "Apply for leave" }));
    fireEvent.changeText(screen.getByPlaceholderText("Add a short note (optional)"), "Family function");
    fireEvent.press(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(mockAct).toHaveBeenCalledWith("teacher-token", "applyLeave", {
        typeId: "planned",
        from: "2026-09-01",
        to: "2026-09-01",
        reason: "Family function",
        studentId: undefined,
      });
    });
    expect(onDone).toHaveBeenCalledWith("Leave sent.");
    expect(onError).not.toHaveBeenCalled();
  });
});
