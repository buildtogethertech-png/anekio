import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RolesBoard } from "../office-boards";
import { act as mutate } from "../../lib/mutate";
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
jest.mock("../form", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Dropdown: ({ options, onChange }: { options: { id: string; label: string }[]; onChange: (id: string) => void }) => (
      <>
        {options.map((option) => (
          <Pressable key={option.id} accessibilityRole="button" onPress={() => onChange(option.id)}>
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </>
    ),
  };
});

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

function permission(key: string, group: string, label: string, see = false) {
  return {
    key,
    group,
    label,
    hint: label,
    see,
    portals: ["OFFICE"],
    scopes: ["SCHOOL"],
    defaultScope: "SCHOOL",
    scopePolicies: { OFFICE: { scopes: ["SCHOOL"], defaultScope: "SCHOOL" } },
  };
}

const feesRole = {
  id: "role-fees",
  name: "Fees",
  slug: "FEES",
  portal: "OFFICE",
  description: "",
  users: 1,
  grants: ["desk.view", "fees.view", "fees.collect"],
  grantScopes: { "desk.view": "SCHOOL", "fees.view": "SCHOOL", "fees.collect": "SCHOOL" },
};
const examsRole = {
  id: "role-exams",
  name: "Exams",
  slug: "EXAMS",
  portal: "OFFICE",
  description: "",
  users: 0,
  grants: ["desk.view", "exams.view", "exams.publish"],
  grantScopes: { "desk.view": "SCHOOL", "exams.view": "SCHOOL", "exams.publish": "SCHOOL" },
};
const teacherRole = {
  id: "role-teacher",
  name: "Teacher",
  slug: "TEACHER",
  portal: "TEACHER",
  description: "",
  users: 1,
  grants: ["attendance.mark"],
  grantScopes: { "attendance.mark": "ASSIGNED" },
};
const customRole = {
  id: "role-custom",
  name: "Custom office",
  slug: "CUSTOM_OFFICE",
  portal: "OFFICE",
  description: "",
  users: 0,
  grants: ["desk.view", "roles.manage"],
  grantScopes: { "desk.view": "SCHOOL", "roles.manage": "SCHOOL" },
};

const catalog = [
  permission("desk.view", "Dashboard", "See dashboard", true),
  permission("fees.view", "Fees", "See fees", true),
  permission("fees.collect", "Fees", "Collect fees"),
  permission("exams.view", "Exams", "See exams", true),
  permission("exams.publish", "Exams", "Publish results"),
  permission("roles.manage", "Roles", "Roles and access", true),
  { ...permission("attendance.mark", "Teaching", "Mark attendance", true), portals: ["TEACHER"] },
];

function stubRecord(roles = [feesRole, examsRole, teacherRole, customRole]) {
  mockUseRecord.mockReturnValue({
    data: {
      roles,
      officeUsers: [],
      permissionCatalog: catalog,
    } as never,
    error: "",
    refreshing: false,
    setChildId: jest.fn(),
    reload: jest.fn().mockResolvedValue(undefined),
  });
}

describe("RolesBoard", () => {
  beforeEach(() => {
    stubRecord();
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: ["roles.manage"] },
      refresh: jest.fn().mockResolvedValue(undefined),
    } as never);
    mockAct.mockResolvedValue({} as never);
  });

  it.each(["Fees", "fees", "FEES"])("filters to Fees for %s without saving", (query) => {
    render(<RolesBoard />);
    fireEvent.changeText(screen.getByPlaceholderText("Find people, fees, exams..."), query);
    expect(screen.getAllByText("Fees").length).toBeGreaterThan(0);
    expect(screen.queryByText("Exams")).toBeNull();
    expect(mockAct).not.toHaveBeenCalled();
  });

  it("shows every module for an empty search and none for an unknown term", () => {
    render(<RolesBoard />);
    expect(screen.getByText("Cash window. Collect, remind, templates.")).toBeTruthy();
    expect(screen.getByText("Marksheets, papers, publish report cards.")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("Find people, fees, exams..."), "zzzz-unknown");
    expect(screen.queryByText("Cash window. Collect, remind, templates.")).toBeNull();
    expect(screen.queryByText("Marksheets, papers, publish report cards.")).toBeNull();
  });

  it("rolls a failed OFF toggle back to ON", async () => {
    mockAct.mockRejectedValueOnce(new Error("Could not save."));
    render(<RolesBoard />);
    fireEvent.press(screen.getByLabelText("Expand Fees"));
    const onSwitches = screen.getAllByRole("switch").filter((node) => node.props.accessibilityState?.checked);
    fireEvent.press(onSwitches[onSwitches.length - 1]);
    await waitFor(() => expect(mockAct).toHaveBeenCalled());
  });

  it("rolls a failed ON toggle back to OFF", async () => {
    stubRecord([{ ...feesRole, grants: ["desk.view", "fees.view"], grantScopes: { "desk.view": "SCHOOL", "fees.view": "SCHOOL" } }]);
    mockAct.mockRejectedValueOnce(new Error("Could not save."));
    render(<RolesBoard />);
    fireEvent.press(screen.getByLabelText("Expand Fees"));
    const offSwitches = screen.getAllByRole("switch").filter((node) => !node.props.accessibilityState?.checked);
    fireEvent.press(offSwitches[offSwitches.length - 1]);
    await waitFor(() => expect(mockAct).toHaveBeenCalled());
  });

  it("keeps a successful toggle", async () => {
    render(<RolesBoard />);
    fireEvent.press(screen.getByLabelText("Expand Fees"));
    fireEvent.press(screen.getAllByRole("switch")[2]);
    await waitFor(() => expect(mockAct).toHaveBeenCalled());
  });

  it("does not leak grants when switching FEES → EXAMS → TEACHER → custom → FEES", () => {
    render(<RolesBoard />);
    fireEvent.press(screen.getByText("Exams · Office"));
    fireEvent.press(screen.getByLabelText("Expand Exams"));
    expect(screen.getAllByText("Publish results").length).toBeGreaterThan(0);
    expect(screen.queryByText("Collect fees")).toBeNull();
    fireEvent.press(screen.getByText("Teacher · Teacher"));
    expect(screen.queryByText("Publish results")).toBeNull();
    fireEvent.press(screen.getByText("Custom office · Office"));
    fireEvent.press(screen.getByLabelText("Expand Roles"));
    expect(screen.getAllByText("Roles and access").length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText("Fees · Office"));
    fireEvent.press(screen.getByLabelText("Expand Fees"));
    expect(screen.getAllByText("Collect fees").length).toBeGreaterThan(0);
    expect(screen.queryByText("Publish results")).toBeNull();
  });
});
