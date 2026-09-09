import "react-native-gesture-handler/jestSetup";
import { cleanup } from "@testing-library/react-native";
import { setUpTests } from "react-native-reanimated";

jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// Reanimated 4 needs its deterministic Jest clock/matcher setup under Expo 54.
setUpTests();

afterEach(() => {
  cleanup();
});
