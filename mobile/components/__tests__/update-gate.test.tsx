import { act, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { UpdateGate } from "../update-gate";
import { markUpdateRequired } from "../../lib/app-version";

jest.mock("../../lib/api", () => ({ apiBase: () => "http://test" }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  const { Text } = jest.requireActual("react-native");
  return function Icon({ name }: { name: string }) {
    return <Text>{name}</Text>;
  };
});

describe("force update screen", () => {
  it("shows the update screen at once, with nothing left invisible (no white screen)", () => {
    render(<UpdateGate />);
    act(() => markUpdateRequired("Update to keep using Anekio."));

    expect(screen.getByText("Update on Play Store")).toBeTruthy();
    expect(screen.getByText("Update to keep using Anekio.")).toBeTruthy();
    // A fade of our own used to start at opacity 0 and could stay there on Android: nothing may be transparent.
    const hidden = screen.UNSAFE_root.findAll((node) => StyleSheet.flatten(node.props.style)?.opacity === 0);
    expect(hidden).toHaveLength(0);
  });
});
