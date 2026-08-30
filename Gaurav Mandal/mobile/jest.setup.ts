import "react-native-gesture-handler/jestSetup";
import { cleanup } from "@testing-library/react-native";
import { setUpTests } from "react-native-reanimated";

// Reanimated 4 needs its deterministic Jest clock/matcher setup under Expo 54.
setUpTests();

afterEach(() => {
  cleanup();
});
