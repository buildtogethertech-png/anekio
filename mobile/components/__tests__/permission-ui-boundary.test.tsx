import { fireEvent, render, screen } from "@testing-library/react-native";
import { NavMenu } from "../nav-menu";
import { TeacherAttendanceBoard } from "../family-boards";
import { ExamMarksReview } from "../exam-marks-review";
import { QuickDocumentButton } from "../document-studio";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@expo/vector-icons/Ionicons", () => function MockIonicon() { return null; });
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));
jest.mock("../../lib/record", () => ({ useRecord: jest.fn() }));
jest.mock("../../lib/session", () => ({ useSession: jest.fn() }));
jest.mock("../../lib/assets", () => ({ useAssetUrl: () => "" }));
jest.mock("../date-field", () => ({ DateField: () => null, MonthField: () => null }));
jest.mock("../form", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Dropdown: ({ options, onChange }: { options: { id: string; label: string }[]; onChange: (id: string) => void }) => (
      <>
        {options?.map((option) => (
          <Pressable key={option.id} accessibilityRole="button" onPress={() => onChange(option.id)}>
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </>
    ),
  };
});

const mockUseRecord = useRecord as jest.MockedFunction<typeof useRecord>;
const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

describe("permission UI boundaries", () => {
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

  it("hides Roles nav when roles.manage is off", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["fees.view"], portal: "OFFICE" },
      nav: [{ key: "fees", label: "Fees" }],
      signOut: jest.fn(),
      refresh: jest.fn(),
    } as never);
    render(<NavMenu />);
    expect(screen.queryByText("Roles & permissions")).toBeNull();
  });

  it("shows Roles nav when roles.manage is on", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["roles.manage"], portal: "OFFICE" },
      nav: [{ key: "roles", label: "Roles & permissions" }],
      signOut: jest.fn(),
      refresh: jest.fn(),
    } as never);
    render(<NavMenu />);
    expect(screen.getByText("Roles & permissions")).toBeTruthy();
  });

  it("hides teacher Save the day unless attendance.mark is on", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: [], portal: "TEACHER" },
      nav: [],
      signOut: jest.fn(),
      refresh: jest.fn(),
    } as never);
    render(<TeacherAttendanceBoard />);
    expect(screen.queryByText("Save the day")).toBeNull();
  });

  it("hides Publish to parents unless exams.publish is granted", () => {
    function can(user: { permissions: string[] } | null, key: string) {
      return Boolean(user?.permissions.includes(key));
    }
    const exams = [
      {
        id: "exam-1",
        title: "Math",
        date: "2026-10-01",
        maxMarks: 40,
        workflowStatus: "APPROVED",
        subject: { id: "subject-1a-math", name: "Mathematics" },
      },
    ];
    const props = {
      token: "t",
      sessionLabel: "2026-27",
      seriesName: "Term 1",
      classLabel: "1-A",
      exams: exams as never,
      marks: [],
      students: [{ id: "stu-1", name: "Aisha Khan", admissionNo: "01" } as never],
      pending: "",
      approvedCount: 1,
      onPublish: () => undefined,
      onRan: async () => undefined,
    };
    const off = render(
      <ExamMarksReview {...props} canPublish={can({ permissions: ["exams.view"] }, "exams.publish")} />
    );
    expect(off.queryByText("Publish 1 to parents")).toBeNull();
    off.unmount();
    render(
      <ExamMarksReview {...props} canPublish={can({ permissions: ["exams.publish"] }, "exams.publish")} />
    );
    expect(screen.getByText("Publish 1 to parents")).toBeTruthy();
  });

  it("hides class-batch document copy unless documents.batch is granted", () => {
    mockUseSession.mockReturnValue({
      token: "t",
      user: { permissions: ["documents.issue"] },
    } as never);
    const data = {
      documentStudio: {
        templates: [
          {
            id: "tmpl-1",
            type: "BONAFIDE",
            name: "Bonafide",
            status: "ACTIVE",
            category: "STUDENT",
            activeVersion: 1,
            builtIn: false,
          },
        ],
        defaults: [],
      },
      people: [],
      staff: [],
      school: { policy: {} },
    };
    const batch = [{ subjectType: "STUDENT", subjectId: "stu-1", subjectLabel: "Aisha Khan" }];
    render(
      <QuickDocumentButton
        data={data as never}
        subjectType="STUDENT"
        subjectId="stu-1"
        subjectLabel="1-A"
        allowedTypes={["BONAFIDE"]}
        label="Issue class"
        batchSubjects={batch}
      />
    );
    fireEvent.press(screen.getByText("Issue class"));
    expect(screen.queryByText(/Class batch/)).toBeNull();
  });
});
