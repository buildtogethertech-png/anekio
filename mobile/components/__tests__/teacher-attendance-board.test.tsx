import { render, screen } from "@testing-library/react-native";
import { StaffAttendanceQrButton } from "../staff-attendance-qr";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  return function MockIonicon() {
    return null;
  };
});
jest.mock("../../lib/mutate", () => ({ act: jest.fn() }));

describe("teacher dashboard QR", () => {
  it("is enabled before attendance is marked", () => {
    render(<StaffAttendanceQrButton token="teacher-token" alreadyMarked={false} onMessage={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Show attendance QR" })).toBeEnabled();
  });

  it("is disabled when the dashboard loads with attendance already marked", () => {
    render(<StaffAttendanceQrButton token="teacher-token" alreadyMarked onMessage={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Attendance already marked for today" })).toBeDisabled();
    expect(screen.getByText("Attendance already marked for today")).toBeTruthy();
  });
});
