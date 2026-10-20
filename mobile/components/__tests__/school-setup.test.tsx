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
  it("starts a new school with an empty catalog", () => {
    render(
      <SchoolSubjectsForm
        catalog={[]}
        classes={[{ id: "class-1-a", label: "1-A", name: "1", subjects: [] }]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.getByText("0 subjects")).toBeTruthy();
    expect(screen.getByText("No catalog subjects yet. Add one or upload a CSV.")).toBeTruthy();
    expect(screen.queryByLabelText("Open English")).toBeNull();
  });

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
    expect(screen.getByLabelText("Remove English")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.queryByLabelText("Remove Mathematics")).toBeNull();
    expect(screen.getByText("2-A")).toBeTruthy();

    fireEvent.press(screen.getByText("2-A"));
    expect(screen.getByText("2-A — Subjects")).toBeTruthy();
    expect(screen.queryByLabelText("Remove English")).toBeNull();
    expect(screen.getByText("No subjects on this class yet. Add from the school catalog.")).toBeTruthy();
  });

  it("adds a catalog subject by name and rejects a duplicate", () => {
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
    fireEvent.changeText(screen.getByLabelText("Subject name"), "Science");
    fireEvent.press(screen.getByText("Add to catalog"));
    expect(screen.getByLabelText("Edit Science in catalog")).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText("Subject name"), "hindi");
    fireEvent.press(screen.getByText("Add to catalog"));
    expect(screen.getByText("That subject is already in the catalog.")).toBeTruthy();
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
          },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText("Remove English"));
    expect(screen.getByText("1-A — Subjects")).toBeTruthy();
    expect(screen.getByText("No subjects on this class yet. Add from the school catalog.")).toBeTruthy();
    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.getByLabelText("Edit English in catalog")).toBeTruthy();
  });

  it("renames a catalog subject for every class that uses it", async () => {
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
          {
            id: "class-6-b",
            label: "6-B",
            name: "6",
            subjects: [{ id: "s-b", code: "ART-01", name: "Art", weightage: 4 }],
          },
        ]}
        onSaveCatalog={onSaveCatalog}
        onSaveClass={jest.fn()}
      />
    );

    expect(screen.queryByLabelText("Edit Art")).toBeNull();
    fireEvent.press(screen.getByText("Manage catalog"));
    fireEvent.press(screen.getByLabelText("Edit Art in catalog"));
    fireEvent.changeText(screen.getByDisplayValue("Art"), "Fine Art");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaveCatalog).toHaveBeenCalledWith(
        [expect.objectContaining({ name: "Fine Art", previousName: "Art" })],
        false
      )
    );
    fireEvent.press(screen.getByText("Close"));
    expect(screen.getByLabelText("Remove Fine Art")).toBeTruthy();
    fireEvent.press(screen.getByText("6-B"));
    expect(screen.getByLabelText("Remove Fine Art")).toBeTruthy();
  });

  it("pops up when a catalog rename collides with another catalog name", () => {
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
            subjects: [
              { id: "s-a", code: "ART-01", name: "Art", weightage: 4 },
              { id: "s-e", code: "ENG", name: "English", weightage: 4 },
            ],
          },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );

    expect(screen.queryByLabelText("Edit Art")).toBeNull();
    fireEvent.press(screen.getByText("Manage catalog"));
    fireEvent.press(screen.getByLabelText("Edit Art in catalog"));
    fireEvent.changeText(screen.getByDisplayValue("Art"), "English");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Can't edit subject")).toBeTruthy();
    expect(screen.getByText("That subject is already in the catalog.")).toBeTruthy();
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
    fireEvent.press(screen.getByLabelText("Mathematics"));
    fireEvent.press(screen.getByText("Add to class"));
    expect(screen.getByLabelText("Remove Mathematics")).toBeTruthy();
    // Sections of one class share a draft, so switching between them doesn't prompt.
    fireEvent.press(screen.getByText("6-B"));
    expect(screen.getByText("6-B — Subjects")).toBeTruthy();
    expect(screen.getByLabelText("Remove Mathematics")).toBeTruthy();
    // Leaving the class with unsaved changes asks first; Discard drops them.
    fireEvent.press(screen.getByText("7-A"));
    expect(screen.getByText("Save and switch")).toBeTruthy();
    fireEvent.press(screen.getByText("Discard"));
    expect(screen.getByText("7-A — Subjects")).toBeTruthy();
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
    expect(screen.getByLabelText("Search subject")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("English"), "Hindi");
    expect(screen.getByText("No subjects match that search.")).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("English"), "art");
    expect(screen.getByLabelText("Edit Art in catalog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save catalog" })).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Edit Art in catalog"));
    fireEvent.changeText(screen.getByDisplayValue("Art"), "Fine Art");
    fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaveCatalog).toHaveBeenCalledWith(
        [expect.objectContaining({ name: "Fine Art", previousCode: "ART-01", previousName: "Art" })],
        false
      )
    );
  });
});

describe("SchoolSubjectsForm add subject", () => {
  it("offers catalog subjects that this class does not already have", () => {
    render(
      <SchoolSubjectsForm
        catalog={[
          { code: "SST-3", name: "Social Studies" },
          { code: "ENG", name: "English" },
          { code: "MAT", name: "Mathematics" },
        ]}
        classes={[
          { id: "class-1-a", label: "1-A", name: "1", subjects: [] },
          { id: "class-2-a", label: "2-A", name: "2", subjects: [{ id: "s1", code: "MAT", name: "Mathematics", weightage: 4 }] },
        ]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );
    fireEvent.press(screen.getByText("+ Add Subject"));
    expect(screen.getByLabelText("Social Studies")).toBeTruthy();
    expect(screen.getByLabelText("English")).toBeTruthy();
    expect(screen.getByLabelText("Mathematics")).toBeTruthy();
    expect(screen.getByText("Pick a subject")).toBeTruthy();
  });

  it("asks before removing a catalog code", () => {
    render(
      <SchoolSubjectsForm
        catalog={[{ code: "ENG", name: "English" }]}
        classes={[{ id: "class-1-a", label: "1-A", name: "1", subjects: [] }]}
        onSaveCatalog={jest.fn()}
        onSaveClass={jest.fn()}
      />
    );
    fireEvent.press(screen.getByText("Manage catalog"));
    expect(screen.getByText("Not used by any class")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Edit English in catalog"));
    fireEvent.press(screen.getByLabelText("Remove English from catalog"));
    expect(screen.getByLabelText("Edit English in catalog")).toBeTruthy();
    fireEvent.press(screen.getByText("Remove"));
    expect(screen.queryByLabelText("Edit English in catalog")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
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
