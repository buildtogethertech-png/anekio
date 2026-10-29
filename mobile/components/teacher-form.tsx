import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Field, Input } from "./ui";
import { formatSubjectLabel, skillMatchesSubject } from "../lib/subject-label";

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
  return subject.name.trim();
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
  focusClassId,
  onCancel,
  onSave,
}: {
  /** Open with this class ready to pick subjects in (Timetable → "Add to 1-A"). */
  focusClassId?: string;
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
  const teachable = classes.filter((klass) => klass.id && (klass.subjects ?? []).length);
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
  const focus = focusClassId && teachable.some((klass) => klass.id === focusClassId) ? focusClassId : "";
  const [shown, setShown] = useState<string[]>(() => {
    const ids = Object.keys(startPicked);
    if (focus && !ids.includes(focus)) return [...ids, focus];
    return ids.length ? ids : teachable[0]?.id ? [teachable[0].id] : [];
  });
  const [openId, setOpenId] = useState(focus || firstAssigned || teachable[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(teacher);
  // "subject": pick what they teach, then the classes. "class": the older class-by-class cards.
  const [mode, setMode] = useState<"subject" | "class">(focus ? "class" : "subject");
  const [subjectsOn, setSubjectsOn] = useState<string[]>(() => [
    ...new Set(Object.values(startPicked).flat().map((n) => n.toLowerCase())),
  ]);

  function subjectsFor(klass: TeacherClassRow) {
    return (klass.subjects ?? []).map((subject) => ({ ...subject, planned: true }));
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

  /** Every subject taught anywhere in the school, with the classes that have it. */
  const subjectRows = (() => {
    const map = new Map<string, { key: string; name: string; classes: { klass: TeacherClassRow; subject: NonNullable<TeacherClassRow["subjects"]>[number] }[] }>();
    for (const klass of teachable) {
      for (const subject of klass.subjects ?? []) {
        const key = subjectCodeOf(subject).toLowerCase();
        const row = map.get(key) || { key, name: subject.name, classes: [] };
        row.classes.push({ klass, subject });
        map.set(key, row);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  function hasPick(classId: string, key: string) {
    return (picked[classId] ?? []).some((code) => code.toLowerCase() === key);
  }

  function setPick(classId: string, subjectName: string, on: boolean) {
    const key = subjectName.toLowerCase();
    const current = (picked[classId] ?? []).filter((code) => code.toLowerCase() !== key);
    const nextCodes = on ? [...current, subjectName] : current;
    setPicked((prev) => {
      const next = { ...prev };
      if (nextCodes.length) next[classId] = nextCodes;
      else delete next[classId];
      return next;
    });
  }

  function setSubjectEverywhere(row: (typeof subjectRows)[number], classIds: string[]) {
    setPicked((prev) => {
      const next = { ...prev };
      for (const { klass, subject } of row.classes) {
        const code = subjectCodeOf(subject);
        const current = (next[klass.id] ?? []).filter((c) => c.toLowerCase() !== row.key);
        const codes = classIds.includes(klass.id) ? [...current, code] : current;
        if (codes.length) next[klass.id] = codes;
        else delete next[klass.id];
      }
      return next;
    });
  }

  function toggleSubject(row: (typeof subjectRows)[number]) {
    if (subjectsOn.includes(row.key)) {
      setSubjectsOn((cur) => cur.filter((k) => k !== row.key));
      setSubjectEverywhere(row, []);
    } else {
      setSubjectsOn((cur) => [...cur, row.key]);
    }
  }

  /** Class-subjects nobody teaches yet (other teachers plus what is picked here). */
  const gaps = subjectRows.flatMap((row) =>
    row.classes
      .filter(({ klass, subject }) => !hasPick(klass.id, row.key) && !alsoTaughtBy(klass, subject).length)
      .map(({ klass }) => `${klass.label} ${row.name}`)
  );

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

        {teachable.length ? (
          <View className="flex-row self-start rounded-lg border border-ink-200 bg-white p-0.5">
            {(
              [
                ["subject", "By subject"],
                ["class", "By class"],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === key }}
                onPress={() => {
                  if (key === "subject") setSubjectsOn([...new Set([...subjectsOn, ...Object.values(picked).flat().map((n) => n.toLowerCase())])]);
                  if (key === "class") setShown((cur) => [...new Set([...cur, ...Object.keys(picked)])]);
                  setMode(key);
                }}
                className={`rounded-md px-3 py-1.5 ${mode === key ? "bg-clay-500" : ""}`}
              >
                <Text className={`text-[13px] font-medium ${mode === key ? "text-white" : "text-ink-700"}`}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {mode === "subject" && teachable.length ? (
          <View className="gap-3">
            <View>
              <Text className="mb-1.5 text-[12px] text-ink-600">1. What can they teach?</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {subjectRows.map((row) => {
                  const on = subjectsOn.includes(row.key);
                  return (
                    <Pressable
                      key={row.key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => toggleSubject(row)}
                      className={`h-8 flex-row items-center gap-1 rounded-full border px-3 ${on ? "border-clay-500 bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                    >
                      {on ? <Ionicons name="checkmark" size={13} color="#1F45C7" /> : null}
                      <Text className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{row.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {subjectRows.filter((row) => subjectsOn.includes(row.key)).length ? (
              <Text className="text-[12px] text-ink-600">2. In which classes?</Text>
            ) : null}
            {subjectRows
              .filter((row) => subjectsOn.includes(row.key))
              .map((row) => {
                const chosen = row.classes.filter(({ klass }) => hasPick(klass.id, row.key));
                const all = chosen.length === row.classes.length;
                const periods = chosen.reduce((n, { subject }) => n + (subject.weightage || 0), 0);
                const others = row.classes
                  .map(({ klass, subject }) => ({ klass, names: alsoTaughtBy(klass, subject) }))
                  .filter((x) => x.names.length);
                const byTeacher = new Map<string, string[]>();
                for (const { klass, names } of others) for (const n of names) byTeacher.set(n, [...(byTeacher.get(n) || []), klass.label]);
                const grades = [...new Set(row.classes.map(({ klass }) => classGrade(klass)))];
                return (
                  <View key={row.key} className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                    <View className="flex-row items-center gap-2 border-b border-ink-100 bg-ink-50 px-3.5 py-2.5">
                      <Text className="text-[15px] font-semibold text-ink-900">{row.name}</Text>
                      <Text className="min-w-0 flex-1 text-[12px] text-ink-500" numberOfLines={1}>
                        {chosen.length ? `${chosen.length} ${chosen.length === 1 ? "class" : "classes"} · ${periods} periods/week` : "Pick classes"}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSubjectEverywhere(row, all ? [] : row.classes.map(({ klass }) => klass.id))}
                        className="rounded-md px-2 py-1"
                      >
                        <Text className="text-[12px] font-semibold text-clay-600">{all ? "Clear" : "All classes"}</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.name}`} hitSlop={8} onPress={() => toggleSubject(row)} className="h-7 w-7 items-center justify-center">
                        <Ionicons name="close" size={15} color="#64748b" />
                      </Pressable>
                    </View>
                    <View className="gap-2 px-3.5 py-3">
                      <View className="flex-row flex-wrap gap-1.5">
                        {row.classes.map(({ klass, subject }) => {
                          const on = hasPick(klass.id, row.key);
                          const taken = alsoTaughtBy(klass, subject).length > 0;
                          return (
                            <Pressable
                              key={klass.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={`${row.name} in ${klass.label}`}
                              onPress={() => setPick(klass.id, subjectCodeOf(subject), !on)}
                              className={`h-9 min-w-[56px] flex-row items-center justify-center gap-1 rounded-md border px-3 ${
                                on ? "border-clay-500 bg-clay-500" : taken ? "border-ink-200 bg-ink-50" : "border-ink-200 bg-white"
                              }`}
                            >
                              {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                              <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{klass.label}</Text>
                              {subject.weightage ? <Text className={`text-[11px] ${on ? "text-white/80" : "text-ink-400"}`}>{`${subject.weightage}`}</Text> : null}
                            </Pressable>
                          );
                        })}
                      </View>
                      {grades.length > 1 && grades.length < row.classes.length ? (
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          <Text className="text-[11px] text-ink-500">Quick:</Text>
                          {grades.map((grade) => {
                            const ids = row.classes.filter(({ klass }) => classGrade(klass) === grade).map(({ klass }) => klass.id);
                            return (
                              <Pressable
                                key={grade}
                                onPress={() =>
                                  setSubjectEverywhere(row, [...new Set([...chosen.map(({ klass }) => klass.id), ...ids])])
                                }
                                className="rounded-full border border-ink-200 px-2 py-0.5"
                              >
                                <Text className="text-[11px] text-ink-700">{`Class ${grade}`}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                      {byTeacher.size ? (
                        <Text className="text-[11px] text-amber-700">
                          {`Also teaching ${row.name}: ${[...byTeacher].map(([n, labels]) => `${n} (${labels.join(", ")})`).join(", ")}`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
          </View>
        ) : null}

        {mode === "class" ? cards.map((klass) => {
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
        }) : null}

        {mode === "class" && remaining.length ? (
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

      {gaps.length ? (
        <View className="flex-row items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
          <Ionicons name="alert-circle-outline" size={15} color="#b45309" />
          <Text className="flex-1 text-[12px] leading-5 text-amber-900">
            {`No teacher yet: ${gaps.slice(0, 6).join(", ")}${gaps.length > 6 ? ` and ${gaps.length - 6} more` : ""}`}
          </Text>
        </View>
      ) : null}
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
