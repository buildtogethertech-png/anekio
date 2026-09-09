import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button, Input, Modal } from "../ui";

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

  it("keeps the card click from dismissing the dialog", () => {
    const onClose = jest.fn();
    const onSave = jest.fn();
    render(
      <Modal
        open
        title="Late timing"
        onClose={onClose}
        footer={
          <Button onPress={onSave}>Save late timing</Button>
        }
      >
        <Input accessibilityLabel="Day starts" value="08:00" />
      </Modal>
    );
    fireEvent.press(screen.getByRole("button", { name: "Save late timing" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
