import { Image } from "react-native";
import { render } from "@testing-library/react-native";
import { PhoneTopBar } from "../notice-bell";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../../lib/session", () => ({
  useSession: () => ({ nav: [] }),
}));

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, {
    get(target, property) {
      if (property === "useWindowDimensions") {
        return () => ({ width: 390, height: 844, scale: 2, fontScale: 1 });
      }
      return Reflect.get(target, property);
    },
  });
});

describe("PhoneTopBar", () => {
  it("pins the Anekio icon to 36px so it cannot fill the phone screen", () => {
    const { UNSAFE_getByType } = render(<PhoneTopBar />);
    expect(UNSAFE_getByType(Image).props.style).toEqual({ width: 36, height: 36 });
  });
});
