import { fireEvent, render, screen } from "@testing-library/react-native";
import { TeacherForm } from "../teacher-form";

const classes = [
  {
    id: "class-1-a",
    label: "1-A",
    name: "1",
    subjects: [
      { id: "s-eng-1", code: "ENG", name: "English", weightage: 4 },
      { id: "s-mat-1", code: "MAT", name: "Mathematics", weightage: 4 },
      { id: "s-hin-1", code: "HIN", name: "Hindi", weightage: 3 },
    ],
  },
  {
    id: "class-1-b",
    label: "1-B",
    name: "1",
    subjects: [{ id: "s-eng-1b", code: "ENG", name: "English", weightage: 4 }],
  },
  {
    id: "class-2-a",
    label: "2-A",
    name: "2",
    subjects: [{ id: "s-sci-2", code: "SCI-2", name: "Science", weightage: 4 }],
  },
];

describe("TeacherForm assignments", () => {
  it("shows a catalog subject coded for this grade even before it is on the class plan", () => {
    render(
      <TeacherForm
        catalog={[{ code: "SAN-5", name: "Sanskrit" }, { code: "ENG", name: "English" }]}
        classes={[
          {
            id: "class-5-a",
            label: "5-A",
            name: "5",
            subjects: [{ id: "s-eng-5", code: "ENG-5", name: "English", weightage: 6 }],
          },
        ]}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("Subjects for 5-A")).toBeTruthy();
    expect(screen.getByText("ENG-5 · English")).toBeTruthy();
    expect(screen.getByText("SAN-5 · Sanskrit")).toBeTruthy();
    expect(screen.queryByText("ENG · English")).toBeNull();
  });

  it("shows only the selected class curriculum, not other-grade codes", () => {
    render(
      <TeacherForm
        classes={classes}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("Subjects for 1-A")).toBeTruthy();
    expect(screen.getByText("ENG · English")).toBeTruthy();
    expect(screen.getByText("MAT · Mathematics")).toBeTruthy();
    expect(screen.getAllByText("4 periods/week").length).toBeGreaterThan(0);
    expect(screen.queryByText("SCI-2 · Science")).toBeNull();
    expect(screen.queryByText("ENG-2 · English")).toBeNull();
  });

  it("loads existing skills grouped by class and keeps 1-A and 1-B separate", () => {
    render(
      <TeacherForm
        teacher={{
          id: "teacher-1",
          name: "Rhea DSouza",
          skills: [
            { subjectName: "ENG", classId: "class-1-a" },
            { subjectName: "MAT", classId: "class-1-a" },
            { subjectName: "ENG", classId: "class-1-b" },
          ],
        }}
        classes={classes}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />
    );

    expect(screen.getByText("Assigned classes")).toBeTruthy();
    expect(screen.getAllByText(/Selected/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1-A").length).toBeGreaterThan(0);
    expect(screen.getByText("1-B")).toBeTruthy();
    expect(screen.getAllByText("ENG · English").length).toBeGreaterThan(1);
    expect(screen.queryByText("SCI-2 · Science")).toBeNull();
  });

  it("lets a teacher take two subjects in one class and a different subject in another", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <TeacherForm
        teacher={{ id: "teacher-1", name: "Kavita", skills: [] }}
        classes={classes}
        onCancel={jest.fn()}
        onSave={onSave}
      />
    );

    fireEvent.press(screen.getByLabelText("Select ENG · English for 1-A"));
    fireEvent.press(screen.getByLabelText("Select MAT · Mathematics for 1-A"));
    fireEvent.press(screen.getByLabelText("Add another class"));
    fireEvent.press(screen.getByLabelText("Select ENG · English for 1-B"));
    fireEvent.press(screen.getByLabelText("Add another class"));
    fireEvent.press(screen.getByLabelText("Select SCI-2 · Science for 2-A"));
    fireEvent.press(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kavita",
        offers: [
          { classId: "class-1-a", subjectCode: "ENG", subjectName: "English" },
          { classId: "class-1-a", subjectCode: "MAT", subjectName: "Mathematics" },
          { classId: "class-1-b", subjectCode: "ENG", subjectName: "English" },
          { classId: "class-2-a", subjectCode: "SCI-2", subjectName: "Science" },
        ],
      })
    );
  });

  it("unassigning a subject does not send that class subject in offers", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <TeacherForm
        teacher={{
          id: "teacher-1",
          name: "Rhea DSouza",
          skills: [{ subjectName: "ENG", classId: "class-1-a" }],
        }}
        classes={classes}
        onCancel={jest.fn()}
        onSave={onSave}
      />
    );

    fireEvent.press(screen.getByLabelText("Unselect ENG · English for 1-A"));
    fireEvent.press(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ offers: [] }));
  });
});
