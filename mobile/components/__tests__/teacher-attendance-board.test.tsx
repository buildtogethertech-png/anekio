import { render, screen } from "@testing-library/react-native";
import { TeacherAttendanceBoard } from "../family-boards";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@expo/vector-icons/Ionicons", () => function MockIonicon() { return null; });
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
jest.mock("../date-field", () => ({ DateField: () => null, MonthField: () => null }));
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const useWindowDimensions = jest.fn(() => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }));
  return new Proxy(actual, {
    get(target, property) {
      if (property === "useWindowDimensions") return useWindowDimensions;
      return Reflect.get(target, property);
    },
  });
});

const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

describe("TeacherAttendanceBoard", () => {
  beforeEach(() => {
    mockUseRecord.mockReturnValue({
      data: {
        roster: [{ id: "stu-1", name: "Aisha Khan", today: "not marked", days: [] }],
        calendar: { weekdays: [1, 2, 3, 4, 5], holidays: [] },
      } as never,
      error: "",
      refreshing: false,
      setChildId: jest.fn(),
      reload: jest.fn(),
    });
  });

  it("shows Save the day only when attendance.mark is granted", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["attendance.mark"] },
    } as never);
    render(<TeacherAttendanceBoard />);
    expect(screen.getByRole("button", { name: "Save the day" })).toBeTruthy();
  });

  it("hides Save the day when attendance.mark is off", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["class.view"] },
    } as never);
    render(<TeacherAttendanceBoard />);
    expect(screen.queryByText("Save the day")).toBeNull();
  });
});
