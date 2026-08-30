import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { RolesBoard, StaffBoard } from "../office-boards";
import { act as mutate } from "../../lib/mutate";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
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

const mockAct = mutate as jest.MockedFunction<typeof mutate>;
const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockUseWindowDimensions = jest.requireMock("react-native").__mockUseWindowDimensions as jest.Mock;

const leave = (id: string, subjectName: string, reason = "") => ({
  id,
  typeId: "casual",
  typeName: "Casual leave",
  from: "2026-08-24",
  to: "2026-08-25",
  reason,
  status: "ACTIVE" as const,
  who: "staff" as const,
  subjectId: `staff-${id}`,
  subjectName,
  classLabel: "",
  waitingOn: "" as const,
  days: 2,
});

function record(
  pendingLeave = [] as ReturnType<typeof leave>[],
  today = "PRESENT",
  holidays = [] as { date: string; name: string }[]
) {
  return {
    pendingLeave,
    school: { holidays, sessions: [] },
    timetable: { weekdays: [1, 2, 3, 4, 5, 6] },
    staffRoles: [],
    managers: [],
    staff: [
      {
        id: "staff-1",
        kind: "staff",
        name: "Asha Rao",
        role: "Accountant",
        today,
        days: [],
      },
    ],
  };
}

describe("StaffBoard leave requests", () => {
  let currentData: ReturnType<typeof record>;
  let reload: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    mockUseWindowDimensions.mockReturnValue({ width: 1200, height: 800, scale: 1, fontScale: 1 });
    currentData = record();
    reload = jest.fn().mockResolvedValue(undefined);
    mockUseRecord.mockImplementation(() => ({
      data: currentData as never,
      error: "",
      refreshing: false,
      setChildId: jest.fn(),
      reload,
    }));
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: ["staff.edit"] },
    } as ReturnType<typeof useSession>);
    mockAct.mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("hides the leave action when no requests exist and keeps the register visible", () => {
    render(<StaffBoard />);

    expect(screen.queryByRole("button", { name: /Leave requests/ })).toBeNull();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
  });

  it.each([390, 1200])("opens every request detail from the compact counted action at %ipx", (width) => {
    mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    currentData = record([
      leave("leave-1", "Meera Singh", "Family function"),
      leave("leave-2", "Kabir Shah"),
    ]);
    render(<StaffBoard />);

    expect(screen.getByRole("button", { name: "Leave requests (2)" })).toBeTruthy();
    expect(screen.queryByText("Meera Singh · Casual leave")).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Leave requests (2)" }));

    expect(screen.getByText("Meera Singh · Casual leave")).toBeTruthy();
    expect(screen.getByText("2026-08-24–2026-08-25 · Family function")).toBeTruthy();
    expect(screen.getByText("Kabir Shah · Casual leave")).toBeTruthy();
    expect(screen.getByText("2026-08-24–2026-08-25")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2);
  });

  it("keeps the modal usable and refreshes the count after a successful rejection", async () => {
    currentData = record([leave("leave-1", "Meera Singh"), leave("leave-2", "Kabir Shah")]);
    reload.mockImplementation(async () => {
      currentData = record([leave("leave-2", "Kabir Shah")]);
    });
    const view = render(<StaffBoard />);
    fireEvent.press(screen.getByRole("button", { name: "Leave requests (2)" }));

    fireEvent.press(screen.getAllByRole("button", { name: "Reject" })[0]);

    await waitFor(() => {
      expect(mockAct).toHaveBeenCalledWith("office-token", "decideLeave", {
        requestId: "leave-1",
        yes: false,
      });
      expect(reload).toHaveBeenCalledTimes(1);
    });
    view.rerender(<StaffBoard />);
    expect(screen.getByText("Leave rejected.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave requests (1)" })).toBeTruthy();
    expect(screen.getByText("Kabir Shah · Casual leave")).toBeTruthy();
  });

  it("keeps a request available and shows the existing error toast when rejection fails", async () => {
    currentData = record([leave("leave-1", "Meera Singh")]);
    mockAct.mockRejectedValueOnce(new Error("Decision failed."));
    render(<StaffBoard />);
    fireEvent.press(screen.getByRole("button", { name: "Leave requests (1)" }));

    fireEvent.press(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByText("Decision failed.")).toBeTruthy();
    expect(screen.getByText("Meera Singh · Casual leave")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("dismisses the modal without hiding its action and can reopen it", () => {
    currentData = record([leave("leave-1", "Meera Singh")]);
    render(<StaffBoard />);
    const action = screen.getByRole("button", { name: "Leave requests (1)" });

    fireEvent.press(action);
    expect(screen.getByText("Meera Singh · Casual leave")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Meera Singh · Casual leave")).toBeNull();
    expect(screen.getByRole("button", { name: "Leave requests (1)" })).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Leave requests (1)" }));
    expect(screen.getByText("Meera Singh · Casual leave")).toBeTruthy();
  });

  it("keeps a later request closed after the open request list becomes empty", () => {
    currentData = record([leave("leave-1", "Meera Singh")]);
    const view = render(<StaffBoard />);
    fireEvent.press(screen.getByRole("button", { name: "Leave requests (1)" }));
    expect(screen.getByText("Meera Singh · Casual leave")).toBeTruthy();

    currentData = record();
    view.rerender(<StaffBoard />);
    expect(screen.queryByRole("button", { name: /Leave requests/ })).toBeNull();
    expect(screen.queryByText("Meera Singh · Casual leave")).toBeNull();

    currentData = record([leave("leave-2", "Kabir Shah")]);
    view.rerender(<StaffBoard />);
    expect(screen.getByRole("button", { name: "Leave requests (1)" })).toBeTruthy();
    expect(screen.queryByText("Kabir Shah · Casual leave")).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Leave requests (1)" }));
    expect(screen.getByText("Kabir Shah · Casual leave")).toBeTruthy();
  });

  it("preserves approved leave as a summary, immutable marker, and saved leave status", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-24T06:00:00.000Z"));
    currentData = record([], "LEAVE");
    render(<StaffBoard />);

    expect(screen.getByText("1 on leave")).toBeTruthy();
    expect(screen.getByLabelText("On leave")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Asha Rao present" })).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Save the day" }));

    await waitFor(() =>
      expect(mockAct).toHaveBeenCalledWith("office-token", "markStaffAttendance", {
        date: expect.any(String),
        rows: [{ kind: "staff", id: "staff-1", status: "LEAVE" }],
      })
    );
  });

  it.each([
    [1200, "staff-toolbar-controls", "staff-toolbar-summary"],
    [768, "staff-toolbar-controls", "staff-toolbar-summary"],
    [767, "staff-toolbar-summary", "staff-toolbar-controls"],
    [390, "staff-toolbar-summary", "staff-toolbar-controls"],
  ])("places one Add staff action in the responsive toolbar row at %ipx", (width, actionRow, otherRow) => {
    mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    render(<StaffBoard />);

    expect(screen.getAllByRole("button", { name: "+ Add staff" })).toHaveLength(1);
    expect(within(screen.getByTestId(actionRow)).getByRole("button", { name: "+ Add staff" })).toBeTruthy();
    expect(within(screen.getByTestId(otherRow)).queryByRole("button", { name: "+ Add staff" })).toBeNull();
  });

  it.each([390, 1200])("opens the existing Add staff modal from the relocated action at %ipx", (width) => {
    mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    render(<StaffBoard />);

    fireEvent.press(screen.getByRole("button", { name: "+ Add staff" }));
    expect(screen.getByText("Joining date")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Joining date")).toBeNull();
  });

  it.each([390, 1200])("omits Add staff for read-only users at %ipx", (width) => {
    mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: [] },
    } as unknown as ReturnType<typeof useSession>);
    render(<StaffBoard />);

    expect(screen.queryByRole("button", { name: "+ Add staff" })).toBeNull();
    expect(within(screen.getByTestId("staff-toolbar-controls")).getByText("Search")).toBeTruthy();
    expect(within(screen.getByTestId("staff-toolbar-controls")).getByText("Date")).toBeTruthy();
  });

  it.each([
    [1200, "staff-toolbar-controls"],
    [390, "staff-toolbar-summary"],
  ])("preserves responsive toolbar placement on a closed day at %ipx", (width, actionRow) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-24T06:00:00.000Z"));
    mockUseWindowDimensions.mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    currentData = record([], "PRESENT", [{ date: "2026-08-24", name: "Founder's Day" }]);
    render(<StaffBoard />);

    expect(screen.getByText("Founder's Day — school closed.")).toBeTruthy();
    expect(screen.queryByText("1 P")).toBeNull();
    expect(screen.queryByText("0 A")).toBeNull();
    expect(within(screen.getByTestId("staff-toolbar-controls")).getByText("Search")).toBeTruthy();
    expect(within(screen.getByTestId("staff-toolbar-controls")).getByText("Date")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "+ Add staff" })).toHaveLength(1);
    expect(within(screen.getByTestId(actionRow)).getByRole("button", { name: "+ Add staff" })).toBeTruthy();
  });
});

describe("RolesBoard permission scopes", () => {
  beforeEach(() => {
    mockUseWindowDimensions.mockReturnValue({ width: 1200, height: 800, scale: 1, fontScale: 1 });
    mockUseRecord.mockReturnValue({
      data: {
        roles: [
          {
            id: "role-admin",
            name: "Admin",
            slug: "ADMIN",
            portal: "OFFICE",
            description: "",
            users: 1,
            grants: ["desk.view", "leave.decide"],
            grantScopes: { "desk.view": "SCHOOL", "leave.decide": "REPORTS" },
          },
        ],
        officeUsers: [],
        permissionCatalog: [
          {
            key: "desk.view",
            group: "Desk",
            label: "See desk",
            hint: "",
            see: true,
            portals: ["OFFICE"],
            scopes: ["SCHOOL"],
            defaultScope: "SCHOOL",
            scopePolicies: { OFFICE: { scopes: ["SCHOOL"], defaultScope: "SCHOOL" } },
          },
          {
            key: "leave.decide",
            group: "Staff",
            label: "Decide staff leave",
            hint: "",
            portals: ["OFFICE"],
            scopes: ["REPORTS", "SCHOOL"],
            defaultScope: "REPORTS",
            scopePolicies: {
              OFFICE: { scopes: ["REPORTS", "SCHOOL"], defaultScope: "REPORTS" },
            },
          },
        ],
      } as never,
      error: "",
      refreshing: false,
      setChildId: jest.fn(),
      reload: jest.fn().mockResolvedValue(undefined),
    });
    mockUseSession.mockReturnValue({
      token: "office-token",
      user: { permissions: ["roles.manage"] },
      refresh: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useSession>);
    mockAct.mockResolvedValue({} as never);
  });

  it("shows fixed scope context and saves a selectable scope", async () => {
    render(<RolesBoard />);

    expect(screen.getByText("Scope: Whole school")).toBeTruthy();
    expect(screen.getByText("Direct reports")).toBeTruthy();
    fireEvent.press(screen.getByText("Whole school"));

    await waitFor(() =>
      expect(mockAct).toHaveBeenCalledWith("office-token", "setRolePermissions", {
        roleId: "role-admin",
        changes: [{ permission: "leave.decide", on: true, scope: "SCHOOL" }],
      })
    );
  });
});
