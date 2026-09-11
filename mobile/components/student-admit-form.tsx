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
  admissionNo: string;
  dateOfBirth: string;
  classId: string;
  parentId: string;
  tags: string[];
  feeAddOns: StudentFeeAddOnPayload[];
};

function emptyForm(classes: { id: string }[]): StudentAdmitPayload {
  return {
    name: "",
    admissionNo: "",
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
  feeAddOnOptions = [],
  onSubmit,
}: {
  classes: { id: string; label: string }[];
  parents: { id: string; name: string; phone?: string }[];
  feeAddOnOptions?: { id?: string; classId?: string; label: string; kind?: string; amount: number; startsPeriod?: string; endsPeriod?: string }[];
  onSubmit: (values: StudentAdmitPayload) => Promise<void>;
}) {
  const [form, setForm] = useState(() => emptyForm(classes));
  const [busy, setBusy] = useState(false);
  const availableAddOns = feeAddOnOptions
    .filter((option) => !option.classId || option.classId === form.classId)
    .filter((option, index, rows) => rows.findIndex((row) => row.label.toLowerCase() === option.label.toLowerCase()) === index);

  function patch(part: Partial<StudentAdmitPayload>) {
    setForm((prev) => ({ ...prev, ...part }));
  }

  function toggleAddOn(option: { id?: string; label: string; kind?: string; amount: number; startsPeriod?: string; endsPeriod?: string }) {
    const found = form.feeAddOns.some((row) => row.label.toLowerCase() === option.label.toLowerCase());
    patch({
      feeAddOns: found
        ? form.feeAddOns.filter((row) => row.label.toLowerCase() !== option.label.toLowerCase())
        : [
            ...form.feeAddOns,
            {
              id: option.id,
              label: option.label,
              kind: option.kind || "CHARGE",
              amount: String(option.amount),
              cadence: "MONTHLY",
              startsPeriod: option.startsPeriod || "",
              endsPeriod: option.endsPeriod || "",
            },
          ],
    });
  }

  async function save() {
    if (busy) return;
    if (!form.name.trim() || !form.admissionNo.trim() || !form.dateOfBirth || !form.classId || !form.parentId) {
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
      <Field label="Admission no.">
        <Input value={form.admissionNo} onChangeText={(admissionNo) => patch({ admissionNo })} />
      </Field>
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
      <Text className="pt-1 text-xs font-medium text-ink-700">Student add-ons · optional</Text>
      {availableAddOns.length ? (
        <View className="flex-row flex-wrap gap-2">
          {availableAddOns.map((option) => {
            const on = form.feeAddOns.some((row) => row.label.toLowerCase() === option.label.toLowerCase());
            return <Chip key={`${option.classId || "all"}-${option.label}`} label={option.label} active={on} onPress={() => toggleAddOn(option)} />;
          })}
        </View>
      ) : (
        <Text className="rounded-md border border-dashed border-ink-200 px-3 py-2 text-xs text-ink-700">
          No add-ons configured for this class yet.
        </Text>
      )}
      {form.feeAddOns.length ? (
        <View className="gap-2 rounded-md border border-ink-100 bg-ink-50 p-2">
          {form.feeAddOns.map((addOn) => (
            <View key={addOn.label} className="flex-row flex-wrap items-end gap-2">
              <View className="min-w-[160px] flex-1">
                <Text className="mb-1 text-xs font-medium text-ink-700">{addOn.label}</Text>
                <Text className="text-xs text-ink-600">{addOn.kind === "DISCOUNT" ? "Monthly discount" : "Monthly add-on"}</Text>
              </View>
              <View className="w-36">
                <Field label="Amount">
                  <Input
                    keyboardType="number-pad"
                    value={addOn.amount}
                    onChangeText={(amount) =>
                      patch({ feeAddOns: form.feeAddOns.map((row) => (row.label === addOn.label ? { ...row, amount } : row)) })
                    }
                  />
                </Field>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <Button disabled={busy || !classes.length || !parents.length} onPress={save}>
        Add student
      </Button>
    </View>
  );
}
