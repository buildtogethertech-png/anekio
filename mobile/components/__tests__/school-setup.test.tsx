import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ClockForm } from "../school-setup";

describe("ClockForm", () => {
  it("adds a period with the generated name when the name field is blank", async () => {
    const onAdd = jest.fn().mockResolvedValue({
      period: {
        id: "period-1",
        name: "Period 1",
        startsAt: "15:10",
        endsAt: "15:50",
        isBreak: false,
        sortOrder: 1,
      },
    });

    render(
      <ClockForm
        weekdays={[1, 2, 3, 4]}
        periods={[]}
        onSave={jest.fn()}
        onAdd={onAdd}
        onDelete={jest.fn()}
      />
    );

    fireEvent.press(screen.getByRole("button", { name: "Add period" }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({
        name: "Period 1",
        startsAt: "15:10",
        endsAt: "15:50",
        isBreak: false,
      });
    });
  });
});
