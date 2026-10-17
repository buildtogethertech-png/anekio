import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Chip, Field, Input } from "./ui";
import { Select } from "./form/select";
import { catalogCodeMatchesGrade, formatSubjectLabel, skillMatchesSubject } from "../lib/subject-label";

export const QUALIFICATION_OPTIONS = [
  "B.Ed",
  "M.Ed",
  "B.El.Ed",
  "B.Sc",
  "M.Sc",
  "B.A",
  "M.A",
  "B.Tech",
  "CTET",
  "TET",
  "NET",
];

type TeacherClassRow = {
  id: string;
  label: string;
  name?: string;
  subjects?: { id?: string; code?: string; name: string; weightage?: number }[];
};

function classGrade(klass: TeacherClassRow) {
  return (klass.name || klass.label.split("-")[0] || "").trim();
}

function subjectCodeOf(subject: { code?: string; name: string }) {
  return (subject.code || "").trim() || subject.name;
}

function parseQualification(raw?: string | null) {
  if (!raw) return { tags: [] as string[], notes: "" };
  const [head, ...rest] = raw.split(" — ");
  const notes = rest.join(" — ").trim();
  const parts = head.split(" · ").map((s) => s.trim()).filter(Boolean);
  const tags = parts.filter((t) => QUALIFICATION_OPTIONS.includes(t));
  const leftover = parts.filter((t) => !QUALIFICATION_OPTIONS.includes(t));
  return { tags, notes: [notes, ...leftover].filter(Boolean).join(" · ") };
}

function initialClassPicks(
  teacher: { skills: { subjectName: string; classId: string }[] } | undefined,
  classes: TeacherClassRow[]
) {
  const picked: Record<string, string[]> = {};
  for (const skill of teacher?.skills ?? []) {
    const klass = classes.find((row) => row.id === skill.classId);
    const match = (klass?.subjects ?? []).find((subject) =>
      skillMatchesSubject(skill.subjectName, { code: subject.code, name: subject.name })
    );
    const code = match ? subjectCodeOf(match) : "";
    if (!skill.classId || !code) continue;
    const current = picked[skill.classId] ?? [];
    if (!current.includes(code)) picked[skill.classId] = [...current, code];
  }
  return picked;
}

export function TeacherForm({
  teacher,
  classes,
  catalog = [],
  onCancel,
  onSave,
}: {
  teacher?: { id: string; name: string; qualification?: string; skills: { subjectName: string; classId: string }[] };
  classes: TeacherClassRow[];
  catalog?: { code: string; name: string }[];
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    email?: string;
    phone?: string;
    employeeId?: string;
    password?: string;
    qualification: string[];
    qualificationNotes: string;
    offers: { subjectName: string; subjectCode?: string; classId: string }[];
  }) => Promise<void>;
}) {
  const parsed = parseQualification(teacher?.qualification);
  const teachable = classes.filter(
    (klass) =>
      klass.id &&
      ((klass.subjects ?? []).length || catalog.some((entry) => catalogCodeMatchesGrade(entry.code, classGrade(klass))))
  );
  const startPicked = initialClassPicks(teacher, teachable);
  const firstAssigned = Object.keys(startPicked)[0];
  const [name, setName] = useState(teacher?.name || "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("12345");
  const [tags, setTags] = useState<string[]>(parsed.tags);
  const [notes, setNotes] = useState(parsed.notes);
  const [picked, setPicked] = useState<Record<string, string[]>>(startPicked);
  const [classId, setClassId] = useState(firstAssigned || teachable[0]?.id || "");
  const [error, setError] = useState("");
  const editing = Boolean(teacher);
  const selected = teachable.find((klass) => klass.id === classId) || teachable[0];
  const selectedGrade = selected ? classGrade(selected) : "";
  const selectedSubjects = [
    ...(selected?.subjects ?? []),
    ...catalog
      .filter(
        (entry) =>
          selected &&
          catalogCodeMatchesGrade(entry.code, selectedGrade) &&
          !(selected.subjects ?? []).some(
            (subject) => subjectCodeOf(subject) === entry.code || subject.name.trim().toLowerCase() === entry.name.trim().toLowerCase()
          )
      )
      .map((entry) => ({ code: entry.code, name: entry.name, weightage: 4 })),
  ];
  const selectedCodes = selected ? picked[selected.id] ?? [] : [];
  const listedSubjects = [...selectedSubjects].sort((a, b) => {
    const aOn = selectedCodes.includes(subjectCodeOf(a)) ? 0 : 1;
    const bOn = selectedCodes.includes(subjectCodeOf(b)) ? 0 : 1;
    return aOn - bOn;
  });
  const assigned = teachable.filter((klass) => (picked[klass.id] ?? []).length);
  const remaining = teachable.filter((klass) => !(picked[klass.id] ?? []).length);

  function toggleSubject(code: string) {
    if (!selected) return;
    const current = picked[selected.id] ?? [];
    const nextCodes = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
    const next = { ...picked };
    if (nextCodes.length) next[selected.id] = nextCodes;
    else delete next[selected.id];
    setPicked(next);
  }

  function unassign(targetClassId: string, code: string) {
    const current = picked[targetClassId] ?? [];
    const nextCodes = current.filter((item) => item !== code);
    const next = { ...picked };
    if (nextCodes.length) next[targetClassId] = nextCodes;
    else delete next[targetClassId];
    setPicked(next);
  }

  return (
    <View className="gap-3">
      <Field label="Name">
        <Input value={name} onChangeText={setName} />
      </Field>
      {!editing ? (
        <>
          <Field label="Email">
            <Input autoCapitalize="none" value={email} onChangeText={setEmail} />
          </Field>
          <Field label="Mobile">
            <Input keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="10-digit number" />
          </Field>
          <Field label="Employee id">
            <Input value={employeeId} onChangeText={setEmployeeId} placeholder="Auto if blank" />
          </Field>
          <Field label="Login password">
            <Input value={password} onChangeText={setPassword} />
          </Field>
        </>
      ) : null}
      <Text className="text-xs font-medium text-ink-700">Qualification</Text>
      <View className="flex-row flex-wrap gap-2">
        {QUALIFICATION_OPTIONS.map((q) => (
          <Chip
            key={q}
            label={q}
            active={tags.includes(q)}
            onPress={() => setTags(tags.includes(q) ? tags.filter((t) => t !== q) : [...tags, q])}
          />
        ))}
      </View>
      <Input value={notes} onChangeText={setNotes} placeholder="Specialisation — e.g. Physics, Mathematics" />

      <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Teaching assignments</Text>
      <View className="flex-row flex-wrap gap-4">
        <View className="min-w-[280px] flex-1 gap-2">
          {teachable.length ? (
            <Select
              label="Class"
              value={selected?.id || ""}
              placeholder="Pick a class"
              options={teachable.map((klass) => ({
                id: klass.id,
                label: klass.label,
                group: classGrade(klass) ? `Class ${classGrade(klass)}` : undefined,
              }))}
              onChange={setClassId}
            />
          ) : (
            <Text className="text-sm text-ink-700">Load subjects onto a class plan before assigning a teacher.</Text>
          )}
          {selected ? (
            <View className="gap-2">
              <Text className="text-xs font-medium text-ink-700">Subjects for {selected.label}</Text>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 360 }}>
                <View className="gap-2">
                  {listedSubjects.map((subject) => {
                    const code = subjectCodeOf(subject);
                    const on = selectedCodes.includes(code);
                    const periods = subject.weightage && subject.weightage > 0 ? `${subject.weightage} periods/week` : "";
                    return (
                      <Pressable
                        key={`${selected.id}-${code}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${on ? "Unselect" : "Select"} ${formatSubjectLabel(subject.code, subject.name)} for ${selected.label}`}
                        onPress={() => toggleSubject(code)}
                        className={`rounded-md border px-3 py-2 ${on ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}
                      >
                        <Text className="text-sm font-semibold text-ink-900">
                          {formatSubjectLabel(subject.code, subject.name)}
                        </Text>
                        {on || periods ? (
                          <Text className="mt-0.5 text-xs text-ink-700">
                            {[on ? "Selected" : "", periods].filter(Boolean).join(" · ")}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {!selectedSubjects.length ? (
                    <Text className="text-sm text-ink-700">This class has no curriculum yet.</Text>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          ) : null}
        </View>
        <View className="min-w-[240px] flex-1 gap-2">
          {assigned.length ? (
            <View className="min-h-[360px] gap-2 rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Assigned classes</Text>
              {assigned.map((klass) => (
                <View key={klass.id} className="gap-1">
                  <Text className="text-sm font-semibold text-ink-900">{klass.label}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(picked[klass.id] ?? []).map((code) => {
                      const subject = (klass.subjects ?? []).find((row) => subjectCodeOf(row) === code);
                      const label = formatSubjectLabel(subject?.code || code, subject?.name || code);
                      return (
                        <Chip
                          key={`${klass.id}-${code}`}
                          label={label}
                          active
                          onPress={() => unassign(klass.id, code)}
                        />
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="min-h-[120px] justify-center rounded-md border border-dashed border-ink-200 px-3 py-4">
              <Text className="text-sm text-ink-700">Pick subjects for a class. They show up here after you select them.</Text>
            </View>
          )}
          {remaining.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another class"
              onPress={() => setClassId(remaining[0].id)}
            >
              <Text className="text-sm font-semibold text-clay-600">+ Add another class</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          onPress={async () => {
            setError("");
            if (!name.trim() || (!editing && !email.trim())) {
              setError("Name and email are required");
              return;
            }
            if (!editing && phone.replace(/\D/g, "").length < 10) {
              setError("Enter a 10-digit mobile number");
              return;
            }
            const offers = teachable.flatMap((klass) =>
              (picked[klass.id] ?? []).flatMap((code) => {
                const subject = (klass.subjects ?? []).find((row) => subjectCodeOf(row) === code);
                if (!subject) return [];
                return [
                  {
                    subjectCode: subjectCodeOf(subject),
                    subjectName: subject.name,
                    classId: klass.id,
                  },
                ];
              })
            );
            try {
              await onSave({
                name: name.trim(),
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
                employeeId: employeeId.trim() || undefined,
                password: password || undefined,
                qualification: tags,
                qualificationNotes: notes,
                offers,
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save.");
            }
          }}
        >
          {editing ? "Save" : "Add teacher"}
        </Button>
      </View>
    </View>
  );
}
