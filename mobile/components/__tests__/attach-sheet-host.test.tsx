import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { AttachSheetHost } from "../attach-sheet-host";
import { chooseAttachSource } from "../../lib/photo-capture";

const mockGet = jest.fn();
const mockRequest = jest.fn();
jest.mock("expo-camera", () => {
  const { View } = jest.requireActual("react-native");
  return {
    CameraView: View,
    Camera: { getCameraPermissionsAsync: () => mockGet(), requestCameraPermissionsAsync: () => mockRequest() },
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons/Ionicons", () => {
  const { Text } = jest.requireActual("react-native");
  const Icon = ({ name }: { name: string }) => <Text>{name}</Text>;
  Icon.glyphMap = {};
  return Icon;
});

beforeEach(() => {
  Platform.OS = "android";
  jest.useFakeTimers();
  mockGet.mockReset();
  mockRequest.mockReset();
});
afterEach(() => jest.useRealTimers());

function openSheet(files: boolean) {
  render(<AttachSheetHost />);
  let result: Promise<unknown> = Promise.resolve();
  act(() => {
    result = chooseAttachSource({ files });
  });
  return result;
}

describe("attach sheet", () => {
  it("offers Camera, Gallery and File, and Gallery goes to the picker", async () => {
    const result = openSheet(true);
    expect(screen.getByText("Add a photo or file")).toBeTruthy();
    expect(screen.getByLabelText("Camera")).toBeTruthy();
    expect(screen.getByLabelText("File")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Gallery"));
    act(() => jest.runAllTimers());
    await expect(result).resolves.toEqual({ kind: "photos" });
  });

  it("photo-only fields show no File tile", () => {
    openSheet(false);
    expect(screen.getByText("Add a photo")).toBeTruthy();
    expect(screen.queryByLabelText("File")).toBeNull();
  });

  it("asks for the camera from the sheet; if refused, Allow camera stays right there", async () => {
    mockGet.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequest.mockResolvedValue({ granted: false, canAskAgain: true });
    openSheet(false);
    fireEvent.press(screen.getByLabelText("Camera"));
    await waitFor(() => expect(screen.getByText("Allow camera")).toBeTruthy());
    expect(mockRequest).toHaveBeenCalled();
  });

  it("blocked for good: the button opens Settings", async () => {
    mockGet.mockResolvedValue({ granted: false, canAskAgain: false });
    openSheet(false);
    fireEvent.press(screen.getByLabelText("Camera"));
    await waitFor(() => expect(screen.getByText("Open settings")).toBeTruthy());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("allowed: opens the camera, then Use photo returns the picture", async () => {
    mockGet.mockResolvedValue({ granted: true, canAskAgain: true });
    const result = openSheet(false);
    fireEvent.press(screen.getByLabelText("Camera"));
    await waitFor(() => expect(screen.getByLabelText("Take photo")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Close camera"));
    act(() => jest.runAllTimers());
    await expect(result).resolves.toBeNull();
  });
});
