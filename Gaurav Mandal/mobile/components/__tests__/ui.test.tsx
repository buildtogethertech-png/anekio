import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button, Input } from "../ui";

describe("shared UI controls", () => {
  it("exposes a button role and handles a press", () => {
    const onPress = jest.fn();

    render(<Button onPress={onPress}>Save</Button>);
    fireEvent.press(screen.getByRole("button", { name: "Save" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("accepts text through an accessible input", () => {
    const onChangeText = jest.fn();

    render(
      <Input
        accessibilityLabel="Email or number"
        value=""
        onChangeText={onChangeText}
      />
    );
    fireEvent.changeText(screen.getByLabelText("Email or number"), "parent@school.test");

    expect(onChangeText).toHaveBeenCalledWith("parent@school.test");
  });
});
