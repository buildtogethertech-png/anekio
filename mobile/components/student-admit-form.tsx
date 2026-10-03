import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Chip, DateField, Field, Input, Select } from "./form";
import { Switch } from "./ui";

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
  collectAdmissionFee: boolean;
  paymentMethod: string;
  paymentReference: string;
};

function emptyForm(classes: { id: string }[]): StudentAdmitPayload {
  return {
    name: "",
    dateOfBirth: "",
    classId: classes[0]?.id || "",
    parentId: "",
    tags: [],
    feeAddOns: [],
    collectAdmissionFee: false,
    paymentMethod: "CASH",
    paymentReference: "",
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
      <View className="gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-ink-900">Collect admission fee now</Text>
            <Text className="mt-0.5 text-xs leading-4 text-ink-700">Create the configured one-time admission invoice and record the payment with this admission.</Text>
          </View>
          <Switch on={form.collectAdmissionFee} onPress={() => patch({ collectAdmissionFee: !form.collectAdmissionFee })} />
        </View>
        {form.collectAdmissionFee ? (
          <View className="gap-3 border-t border-amber-200 pt-3">
            <Select
              label="Payment method"
              value={form.paymentMethod}
              options={[
                { id: "CASH", label: "Cash" },
                { id: "UPI", label: "UPI" },
                { id: "BANK", label: "Bank transfer" },
                { id: "CHEQUE", label: "Cheque" },
              ]}
              onChange={(paymentMethod) => patch({ paymentMethod })}
            />
            {form.paymentMethod !== "CASH" ? (
              <Field label={form.paymentMethod === "CHEQUE" ? "Cheque number" : "UTR / reference number"}>
                <Input value={form.paymentReference} onChangeText={(paymentReference) => patch({ paymentReference })} />
              </Field>
            ) : null}
          </View>
        ) : null}
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
