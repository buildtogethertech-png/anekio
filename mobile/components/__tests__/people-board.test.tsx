import { render, screen } from "@testing-library/react-native";
import { PeopleBoard } from "../office-boards";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@expo/vector-icons/Ionicons", () => function MockIonicon() { return null; });
jest.mock("../../lib/mutate", () => {
  const act = jest.fn();
  return { act, saveLateTiming: () => act() };
});
jest.mock("../../lib/record", () => ({ useRecord: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
jest.mock("../date-field", () => ({ DateField: () => null, MonthField: () => null }));
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const useWindowDimensions = jest.fn();
  return new Proxy(actual, {
    get(target, property) {
      if (property === "useWindowDimensions" || property === "__mockUseWindowDimensions") {
        return useWindowDimensions;
      }
      return Reflect.get(target, property);
    },
  });
});

const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockUseWindowDimensions = jest.requireMock("react-native").__mockUseWindowDimensions as jest.Mock;

describe("PeopleBoard permission gates", () => {
  beforeEach(() => {
    mockUseWindowDimensions.mockReturnValue({ width: 1200, height: 800, scale: 1, fontScale: 1 });
    mockUseRecord.mockReturnValue({
      data: {
        people: [
          {
            id: "stu-1",
            name: "Aisha Khan",
            classLabel: "1-A",
            billed: "₹1,000",
            paid: "₹0",
            dueNow: "₹1,000",
            invoices: [{ id: "inv-1", status: "due", due: "2026-04-10", title: "April" }],
          },
        ],
        peopleTeachers: [],
        peopleParents: [],
        classes: [{ id: "class-1-a", label: "1-A" }],
      } as never,
      error: "",
      refreshing: false,
      setChildId: jest.fn(),
      reload: jest.fn(),
    });
  });

  it("requires people.import for Import and people.edit for Add student", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["people.view", "people.edit"] },
    } as never);
    render(<PeopleBoard />);
    expect(screen.queryByText("Import")).toBeNull();
    expect(screen.getByText("Add student")).toBeTruthy();
  });

  it("shows Import when people.import is granted without people.edit", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["people.view", "people.import"] },
    } as never);
    render(<PeopleBoard />);
    expect(screen.getByText("Import")).toBeTruthy();
    expect(screen.queryByText("Add student")).toBeNull();
  });

  it("hides Record payment unless fees.collect is granted", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["people.view", "fees.view", "people.edit"] },
    } as never);
    render(<PeopleBoard />);
    expect(screen.queryByText("Record payment")).toBeNull();
  });
});
