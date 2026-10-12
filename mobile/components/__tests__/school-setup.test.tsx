import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ClockForm, SchoolSubjectsForm } from "../school-setup";

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

describe("SchoolSubjectsForm", () => {
  it("shows only the selected class curriculum and keeps catalog off the class list", () => {
    render(
      <SchoolSubjectsForm
        catalog={[
          { code: "ENG", name: "English" },
          { code: "MAT", name: "Mathematics" },
          { code: "HIN", name: "Hindi" },
        ]}
        classes={[
          {
            id: "class-1-a",
            label: "1-A",
            subjects: [{ id: "s1", code: "ENG", name: "English", weightage: 4 }],
            slots: [{ subjectId: "s1" }],
          },
          { id: "class-2-a", label: "2-A", subjects: [] },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    expect(screen.getByText("1-A — Subjects")).toBeTruthy();
    expect(screen.getByText("ENG · English")).toBeTruthy();
    expect(screen.queryByText("MAT · Mathematics")).toBeNull();
    expect(screen.getByText("2-A")).toBeTruthy();

    fireEvent.press(screen.getByText("2-A"));
    expect(screen.getByText("2-A — Subjects")).toBeTruthy();
    expect(screen.queryByText("ENG · English")).toBeNull();
    expect(screen.getByText("No subjects on this class yet. Add from the school catalog.")).toBeTruthy();
  });

  it("lets the class list drop a subject locally so save can clear routine and teachers", () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "ENG", name: "English" }]}
        classes={[
          {
            id: "class-1-a",
            label: "1-A",
            name: "1",
            subjects: [{ id: "s1", code: "ENG", name: "English", weightage: 4 }],
            slots: [{ subjectId: "s1" }],
          },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText("Remove ENG · English"));
    expect(screen.queryByText("ENG · English")).toBeNull();
  });
});
