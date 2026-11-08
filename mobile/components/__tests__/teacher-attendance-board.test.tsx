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

  it("offers the check-out QR when the dashboard loads with attendance already marked", () => {
    render(<StaffAttendanceQrButton token="teacher-token" alreadyMarked onMessage={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Show check-out QR" })).toBeEnabled();
    expect(screen.getByText("Attendance marked for today")).toBeTruthy();
  });
});
