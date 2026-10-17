import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ClockForm, SchoolSubjectsForm, syncGradeSubjectDrafts } from "../school-setup";

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

  it("allows the same catalog name when the code is different", () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "HIN", name: "Hindi" }]}
        classes={[{ id: "class-5-a", label: "5-A", name: "5", subjects: [] }]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText("Manage catalog"));
    fireEvent.press(screen.getByLabelText("Add subject"));
    fireEvent.changeText(screen.getByPlaceholderText("ENG"), "HIN-5");
    fireEvent.changeText(screen.getByPlaceholderText("English"), "HINDI");
    const addButtons = screen.getAllByRole("button", { name: "Add subject" });
    fireEvent.press(addButtons[addButtons.length - 1]);

    expect(screen.queryByText("That subject is already in the catalog.")).toBeNull();
    expect(screen.queryByText("That subject code is already in the catalog.")).toBeNull();
    expect(screen.getByText("HIN · Hindi")).toBeTruthy();
    expect(screen.getByText("HIN-5 · HINDI")).toBeTruthy();
  });

  it("pops up when the subject code is already in the catalog", () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "HIN", name: "Hindi" }]}
        classes={[{ id: "class-5-a", label: "5-A", name: "5", subjects: [] }]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText("Manage catalog"));
    fireEvent.press(screen.getByLabelText("Add subject"));
    fireEvent.changeText(screen.getByPlaceholderText("ENG"), "HIN");
    fireEvent.changeText(screen.getByPlaceholderText("English"), "Hindi");
    const addButtons = screen.getAllByRole("button", { name: "Add subject" });
    fireEvent.press(addButtons[addButtons.length - 1]);

    expect(screen.getByText("Can't add subject")).toBeTruthy();
    expect(screen.getByText("That subject code is already in the catalog.")).toBeTruthy();
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
    expect(screen.getByText("1-A — Subjects")).toBeTruthy();
    expect(screen.getByText("No subjects on this class yet. Add from the school catalog.")).toBeTruthy();
    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.getByText("ENG · English")).toBeTruthy();
  });

  it("edits a class subject on every section of the same class", async () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "ART-01", name: "Art" }]}
        classes={[
          {
            id: "class-6-a",
            label: "6-A",
            name: "6",
            subjects: [{ id: "s-a", code: "ART-01", name: "Art", weightage: 4 }],
          },
          {
            id: "class-6-b",
            label: "6-B",
            name: "6",
            subjects: [{ id: "s-b", code: "ART-01", name: "Art", weightage: 4 }],
          },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText("Edit ART-01 · Art"));
    fireEvent.changeText(screen.getByPlaceholderText("ENG"), "ART-6");
    fireEvent.changeText(screen.getByPlaceholderText("English"), "Fine Art");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("ART-6 · Fine Art")).toBeTruthy();
    fireEvent.press(screen.getByText("6-B"));
    expect(screen.getByText("ART-6 · Fine Art")).toBeTruthy();
    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.getAllByText("ART-6 · Fine Art").length).toBeGreaterThan(0);
  });

  it("pops up when an edited class code is already in the catalog", () => {
    render(
      <SchoolSubjectsForm
        catalog={[
          { code: "ART-01", name: "Art" },
          { code: "ENG", name: "English" },
        ]}
        classes={[
          {
            id: "class-6-a",
            label: "6-A",
            name: "6",
            subjects: [{ id: "s-a", code: "ART-01", name: "Art", weightage: 4 }],
          },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText("Edit ART-01 · Art"));
    fireEvent.changeText(screen.getByPlaceholderText("ENG"), "ENG");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Can't edit subject")).toBeTruthy();
    expect(screen.getByText("That subject code is already in the catalog.")).toBeTruthy();
  });

  it("adds a subject to every section of the same class before save", () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "MATH6", name: "Mathematics" }]}
        classes={[
          { id: "class-6-a", label: "6-A", name: "6", subjects: [] },
          { id: "class-6-b", label: "6-B", name: "6", subjects: [] },
          { id: "class-7-a", label: "7-A", name: "7", subjects: [] },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    expect(screen.getByText(/Class 6 sections share these subjects/)).toBeTruthy();
    fireEvent.press(screen.getByText("+ Add Subject"));
    fireEvent.press(screen.getByText("MATH6 · Mathematics"));
    fireEvent.press(screen.getByText("Add to class"));
    expect(screen.getByText("MATH6 · Mathematics")).toBeTruthy();
    fireEvent.press(screen.getByText("6-B"));
    expect(screen.getByText("6-B — Subjects")).toBeTruthy();
    expect(screen.getByText("MATH6 · Mathematics")).toBeTruthy();
    fireEvent.press(screen.getByText("7-A"));
    expect(screen.getByText("No subjects on this class yet. Add from the school catalog.")).toBeTruthy();
  });

  it("edits a catalog subject and keeps Save catalog as the primary action", async () => {
    const onSaveCatalog = jest.fn().mockResolvedValue(undefined);
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "ART-01", name: "Art" }]}
        classes={[
          {
            id: "class-6-a",
            label: "6-A",
            name: "6",
            subjects: [{ id: "s-a", code: "ART-01", name: "Art", weightage: 4 }],
          },
        ]}
        onSaveCatalog={onSaveCatalog}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.queryByText("Apply to all classes")).toBeNull();
    expect(screen.getByText("Search subject")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("ENG or English"), "Hindi");
    expect(screen.getByText("No subjects match that search.")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("ENG or English"), "art");
    expect(screen.getByLabelText("Edit ART-01 · Art in catalog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save catalog" })).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Edit ART-01 · Art in catalog"));
    fireEvent.changeText(screen.getByPlaceholderText("ENG"), "ART-6");
    fireEvent.changeText(screen.getByPlaceholderText("English"), "Fine Art");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaveCatalog).toHaveBeenCalledWith(
        [expect.objectContaining({ code: "ART-6", name: "Fine Art", previousCode: "ART-01" })],
        false
      )
    );
  });
});

describe("syncGradeSubjectDrafts", () => {
  it("copies definition changes across sections without sharing row ids", () => {
    const next = syncGradeSubjectDrafts(
      {
        "class-6-a": [{ id: "s-a", code: "ENG6", previousCode: "ENG6", name: "English", periods: "4" }],
        "class-6-b": [{ id: "s-b", code: "ENG6", previousCode: "ENG6", name: "English", periods: "4" }],
        "class-7-a": [],
      },
      [
        { id: "class-6-a", label: "6-A", name: "6" },
        { id: "class-6-b", label: "6-B", name: "6" },
        { id: "class-7-a", label: "7-A", name: "7" },
      ],
      "class-6-a",
      [{ id: "s-a", code: "ENG6A", previousCode: "ENG6", name: "English Language", periods: "5" }]
    );
    expect(next["class-6-a"][0]).toMatchObject({ id: "s-a", code: "ENG6A", periods: "5" });
    expect(next["class-6-b"][0]).toMatchObject({ id: "s-b", code: "ENG6A", name: "English Language", periods: "5" });
    expect(next["class-7-a"]).toEqual([]);
  });
});
