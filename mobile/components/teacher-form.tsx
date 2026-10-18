import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Field, Input } from "./ui";
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
  others = [],
  onCancel,
  onSave,
}: {
  teacher?: { id: string; name: string; qualification?: string; skills: { subjectName: string; classId: string }[] };
  classes: TeacherClassRow[];
  catalog?: { code: string; name: string }[];
  /** Other teachers, to show who already teaches a subject ("Also: Ravi"). */
  others?: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
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
  // Classes shown as cards: every class with picks, plus ones the user just added.
  const [shown, setShown] = useState<string[]>(() => {
    const ids = Object.keys(startPicked);
    return ids.length ? ids : teachable[0]?.id ? [teachable[0].id] : [];
  });
  const [openId, setOpenId] = useState(firstAssigned || teachable[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(teacher);

  function subjectsFor(klass: TeacherClassRow) {
    const grade = classGrade(klass);
    const planned = (klass.subjects ?? []).map((subject) => ({ ...subject, planned: true }));
    const extra = catalog
      .filter(
        (entry) =>
          catalogCodeMatchesGrade(entry.code, grade) &&
          !(klass.subjects ?? []).some(
            (subject) => subjectCodeOf(subject) === entry.code || subject.name.trim().toLowerCase() === entry.name.trim().toLowerCase()
          )
      )
      .map((entry) => ({ code: entry.code, name: entry.name, weightage: 0, planned: false }));
    return [...planned, ...extra];
  }

  function periodsOf(klass: TeacherClassRow, code: string) {
    const subject = (klass.subjects ?? []).find((row) => subjectCodeOf(row) === code);
    return subject?.weightage && subject.weightage > 0 ? subject.weightage : 0;
  }

  function alsoTaughtBy(klass: TeacherClassRow, subject: { code?: string; name: string }) {
    return others
      .filter((other) => other.id !== teacher?.id)
      .filter((other) =>
        other.skills.some((skill) => skill.classId === klass.id && skillMatchesSubject(skill.subjectName, { code: subject.code, name: subject.name }))
      )
      .map((other) => other.name.split(" ")[0]);
  }

  function toggle(targetClassId: string, code: string) {
    const current = picked[targetClassId] ?? [];
    const nextCodes = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
    const next = { ...picked };
    if (nextCodes.length) next[targetClassId] = nextCodes;
    else delete next[targetClassId];
    setPicked(next);
  }

  function removeClass(targetClassId: string) {
    const next = { ...picked };
    delete next[targetClassId];
    setPicked(next);
    setShown((cur) => cur.filter((id) => id !== targetClassId));
    if (openId === targetClassId) setOpenId("");
  }

  function addClass(targetClassId: string) {
    setShown((cur) => (cur.includes(targetClassId) ? cur : [...cur, targetClassId]));
    setOpenId(targetClassId);
    setAdding(false);
  }

  const cards = teachable.filter((klass) => shown.includes(klass.id));
  const remaining = teachable.filter((klass) => !shown.includes(klass.id));
  const totalPeriods = teachable.reduce(
    (sum, klass) => sum + (picked[klass.id] ?? []).reduce((acc, code) => acc + periodsOf(klass, code), 0),
    0
  );
  const totalClasses = teachable.filter((klass) => (picked[klass.id] ?? []).length).length;
  const totalSubjects = teachable.reduce((sum, klass) => sum + (picked[klass.id] ?? []).length, 0);

  return (
    <View className="gap-4">
      <Field label="Name">
        <Input value={name} onChangeText={setName} />
      </Field>
      {!editing ? (
        <View className="flex-row flex-wrap gap-3">
          <View className="min-w-[220px] flex-1">
            <Field label="Email">
              <Input autoCapitalize="none" value={email} onChangeText={setEmail} />
            </Field>
          </View>
          <View className="min-w-[220px] flex-1">
            <Field label="Mobile">
              <Input keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="10-digit number" />
            </Field>
          </View>
          <View className="min-w-[220px] flex-1">
            <Field label="Employee id">
              <Input value={employeeId} onChangeText={setEmployeeId} placeholder="Auto if blank" />
            </Field>
          </View>
          <View className="min-w-[220px] flex-1">
            <Field label="Login password">
              <Input value={password} onChangeText={setPassword} />
            </Field>
          </View>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-xs font-medium text-ink-700">Qualification</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {QUALIFICATION_OPTIONS.map((q) => {
            const on = tags.includes(q);
            return (
              <Pressable
                key={q}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setTags(on ? tags.filter((t) => t !== q) : [...tags, q])}
                className={`h-8 flex-row items-center gap-1 rounded-full border px-3 ${on ? "border-clay-500 bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
              >
                {on ? <Ionicons name="checkmark" size={13} color="#1F45C7" /> : null}
                <Text className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{q}</Text>
              </Pressable>
            );
          })}
        </View>
        <Input value={notes} onChangeText={setNotes} placeholder="Specialisation (optional) — e.g. Physics, Mathematics" />
      </View>

      <View className="gap-2">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Teaches</Text>
          <View className="flex-row items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1">
            <Ionicons name="time-outline" size={13} color="#334155" />
            <Text className="text-[12px] font-semibold text-ink-900">
              {totalSubjects
                ? `${totalPeriods} periods/week · ${totalSubjects} ${totalSubjects === 1 ? "subject" : "subjects"} · ${totalClasses} ${totalClasses === 1 ? "class" : "classes"}`
                : "Nothing assigned yet"}
            </Text>
          </View>
        </View>

        {!teachable.length ? (
          <Text className="text-sm text-ink-700">Load subjects onto a class plan before assigning a teacher.</Text>
        ) : null}

        {cards.map((klass) => {
          const codes = picked[klass.id] ?? [];
          const open = openId === klass.id;
          const periods = codes.reduce((acc, code) => acc + periodsOf(klass, code), 0);
          const list = subjectsFor(klass);
          const summary = codes
            .map((code) => (klass.subjects ?? []).find((row) => subjectCodeOf(row) === code)?.name || code)
            .join(", ");
          return (
            <View key={klass.id} className={`overflow-hidden rounded-xl border ${open ? "border-ink-200" : "border-ink-100"} bg-white`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${open ? "Collapse" : "Open"} ${klass.label}`}
                onPress={() => setOpenId(open ? "" : klass.id)}
                className={`flex-row items-center gap-3 px-3.5 py-2.5 ${open ? "border-b border-ink-100 bg-ink-50" : ""}`}
              >
                <Text className="text-[15px] font-semibold text-ink-900">{klass.label}</Text>
                <Text className="min-w-0 flex-1 text-[12px] text-ink-500" numberOfLines={1}>
                  {codes.length
                    ? open
                      ? `${codes.length} ${codes.length === 1 ? "subject" : "subjects"} · ${periods} periods/week`
                      : `${summary} · ${periods} periods`
                    : "Pick subjects"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${klass.label}`}
                  hitSlop={8}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    removeClass(klass.id);
                  }}
                  className="h-7 w-7 items-center justify-center rounded-full"
                >
                  <Ionicons name="close" size={15} color="#64748b" />
                </Pressable>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#64748b" />
              </Pressable>
              {open ? (
                <View>
                  {list.map((subject, i) => {
                    const code = subjectCodeOf(subject);
                    const on = codes.includes(code);
                    const also = alsoTaughtBy(klass, subject);
                    const label = formatSubjectLabel(subject.code, subject.name);
                    return (
                      <Pressable
                        key={`${klass.id}-${code}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on, disabled: !subject.planned }}
                        accessibilityLabel={`${on ? "Unselect" : "Select"} ${label} for ${klass.label}`}
                        disabled={!subject.planned}
                        onPress={() => toggle(klass.id, code)}
                        className={`min-h-[44px] flex-row items-center gap-3 px-3.5 py-2 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#F5F8FF]" : ""}`}
                      >
                        <View
                          className={`h-5 w-5 items-center justify-center rounded-md border ${
                            on ? "border-clay-500 bg-clay-500" : subject.planned ? "border-ink-300 bg-white" : "border-ink-200 bg-ink-50"
                          }`}
                        >
                          {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
                          <Text className={`text-[14px] font-semibold ${subject.planned ? "text-ink-900" : "text-ink-500"}`}>{subject.name}</Text>
                          {subject.code ? (
                            <View className="rounded bg-ink-100 px-1.5 py-0.5">
                              <Text className="text-[10px] font-medium tracking-wide text-ink-700">{subject.code}</Text>
                            </View>
                          ) : null}
                          {!subject.planned ? (
                            <Text className="text-[11px] text-ink-500">{`not on ${klass.label}'s subjects yet`}</Text>
                          ) : also.length ? (
                            <Text className="text-[11px] text-amber-700" numberOfLines={1}>{`Also: ${also.join(", ")}`}</Text>
                          ) : null}
                        </View>
                        {subject.planned && subject.weightage ? (
                          <Text className="text-[12px] text-ink-500">{`${subject.weightage}/wk`}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {!list.length ? <Text className="px-3.5 py-3 text-sm text-ink-700">This class has no curriculum yet.</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {remaining.length ? (
          adding ? (
            <View className="gap-2 rounded-xl border border-dashed border-ink-200 px-3.5 py-3">
              <Text className="text-xs font-medium text-ink-800">Pick a class</Text>
              <View className="flex-row flex-wrap gap-2">
                {remaining.map((klass) => (
                  <Pressable
                    key={klass.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${klass.label}`}
                    onPress={() => addClass(klass.id)}
                    className="h-9 justify-center rounded-md border border-ink-200 bg-white px-3.5"
                  >
                    <Text className="text-[14px] font-medium text-ink-900">{klass.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => setAdding(false)} className="self-start py-1">
                <Text className="text-xs font-medium text-ink-700">Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another class"
              onPress={() => setAdding(true)}
              className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink-200"
            >
              <Ionicons name="add" size={16} color="#2563eb" />
              <Text className="text-sm font-semibold text-clay-600">Add class</Text>
            </Pressable>
          )
        ) : null}
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
