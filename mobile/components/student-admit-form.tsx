import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Chip, DateField, Field, Input, Select } from "./form";

export type StudentFeeAddOnPayload = {
  id?: string;
  label: string;
  kind: string;
  amount: string;
  cadence?: string;
  startsPeriod?: string;
  endsPeriod?: string;
};

const PATH_TAGS = [
  { id: "OLYMPIAD", label: "Olympiad" },
  { id: "SPORTS", label: "Sports" },
  { id: "SPELLING", label: "Spelling" },
  { id: "SCIENCE", label: "Science" },
  { id: "ARTS", label: "Arts" },
] as const;

export type StudentAdmitPayload = {
  name: string;
  dateOfBirth: string;
  classId: string;
  parentId: string;
  tags: string[];
  feeAddOns: StudentFeeAddOnPayload[];
};

function emptyForm(classes: { id: string }[]): StudentAdmitPayload {
  return {
    name: "",
    dateOfBirth: "",
    classId: classes[0]?.id || "",
    parentId: "",
    tags: [],
    feeAddOns: [],
  };
}

function parentOption(p: { id: string; name: string; phone?: string }) {
  const phone = p.phone?.trim();
  const label = phone ? `${p.name} (${phone})` : p.name;
  return { id: p.id, label, searchText: `${p.name} ${phone || ""}`.trim() };
}

export function StudentAdmitForm({
  classes,
  parents,
  onSubmit,
}: {
  classes: { id: string; label: string }[];
  parents: { id: string; name: string; phone?: string }[];
  onSubmit: (values: StudentAdmitPayload) => Promise<void>;
}) {
  const [form, setForm] = useState(() => emptyForm(classes));
  const [busy, setBusy] = useState(false);

  function patch(part: Partial<StudentAdmitPayload>) {
    setForm((prev) => ({ ...prev, ...part }));
  }

  async function save() {
    if (busy) return;
    if (!form.name.trim() || !form.dateOfBirth || !form.classId || !form.parentId) {
      return;
    }
    setBusy(true);
    try {
      await onSubmit(form);
      setForm(emptyForm(classes));
    } catch {
      /* parent shows the error; keep the form */
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <Field label="Name">
        <Input value={form.name} onChangeText={(name) => patch({ name })} autoComplete="name" />
      </Field>
      <Field label="Date of birth">
        <DateField value={form.dateOfBirth} onChange={(dateOfBirth) => patch({ dateOfBirth })} />
      </Field>
      {classes.length ? (
        <Select
          label="Class"
          value={form.classId}
          options={classes.map((c) => ({ id: c.id, label: c.label }))}
          onChange={(classId) => patch({ classId })}
        />
      ) : (
        <Text className="text-sm text-ink-700">Add a class first, then come back.</Text>
      )}
      {parents.length ? (
        <Select
          label="Parent"
          value={form.parentId}
          options={parents.map(parentOption)}
          onChange={(parentId) => patch({ parentId })}
        />
      ) : (
        <Text className="text-sm text-ink-700">Add a parent first, then come back.</Text>
      )}
      <View className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
        <Text className="text-xs font-medium text-ink-800">Admission number is assigned automatically when you add the student.</Text>
      </View>
      <Text className="pt-1 text-xs font-medium text-ink-700">Path · optional</Text>
      <View className="flex-row flex-wrap gap-2">
        {PATH_TAGS.map((t) => {
          const on = form.tags.includes(t.id);
          return (
            <Chip
              key={t.id}
              label={t.label}
              active={on}
              onPress={() =>
                patch({ tags: on ? form.tags.filter((id) => id !== t.id) : [...form.tags, t.id] })
              }
            />
          );
        })}
      </View>
      <Text className="text-xs text-ink-600">After adding the student, opt them into class add-ons from Manage Fees.</Text>
      <Button disabled={busy || !classes.length || !parents.length} onPress={save}>
        Add student
      </Button>
    </View>
  );
}
