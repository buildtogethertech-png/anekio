import { render, screen } from "@testing-library/react-native";
import StaffScanScreen from "../scan";
import StaffScreen from "../index";

jest.mock("../../../../components/staff-attendance-scan-board", () => ({
  StaffAttendanceScanBoard: () => {
    const { Text } = require("react-native");
    return <Text>Dedicated staff scanner</Text>;
  },
}));
jest.mock("../../../../components/screen-page", () => ({
  ScreenPage: ({ screen }: { screen: string }) => {
    const { Text } = require("react-native");
    return <Text>{`Employees page ${screen}`}</Text>;
  },
}));
jest.mock("../../../../components/notice-bell", () => ({
  PhoneTopBar: () => null,
}));

describe("staff scan route", () => {
  it("renders the camera scanner independently of the Employees page", () => {
    render(<StaffScanScreen />);
    expect(screen.getByTestId("staff-scan-screen")).toBeTruthy();
    expect(screen.getByText("Dedicated staff scanner")).toBeTruthy();
    expect(screen.queryByText("Employees page staff")).toBeNull();
    expect(screen.queryByText("Ready to scan")).toBeNull();
    expect(screen.queryByText("Employees")).toBeNull();
  });

  it("keeps the Employees page on the staff index route", () => {
    render(<StaffScreen />);
    expect(screen.getByText("Employees page staff")).toBeTruthy();
    expect(screen.queryByText("Dedicated staff scanner")).toBeNull();
  });
});
