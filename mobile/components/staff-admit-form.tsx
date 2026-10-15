import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AdmissionFormField } from "../lib/record";
import { pickFile, type PickedFile } from "../lib/upload";
import { AdmissionCustomField, fileAccept, SectionCard, UploadTile } from "./student-admit-form";
import { DateField } from "./date-field";
import { Dropdown } from "./form";
import { defaultManagerId, ManagerSelect, type ManagerOption } from "./manager-picker";
import { Button, Field, Input } from "./ui";

export type StaffAdmitRole = { id: string; name: string; portal?: string; slug?: string; isSystem?: boolean };
export type StaffAdmitClass = { id: string; label: string; name?: string; section?: string };

export type StaffAdmitPayload = {
  name: string;
  phone: string;
  roleId: string;
  classId: string;
  joinedOn: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerId: string;
  monthlySalary: string;
  customValues?: Record<string, string>;
};

export type StaffAdmitFiles = Record<string, PickedFile>;

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function suggestedRoleId(roles: StaffAdmitRole[]) {
  return (
    roles.find((r) => r.portal === "OFFICE" && r.name === "Fees")?.id ??
    roles.find((r) => r.portal === "OFFICE" && !r.isSystem)?.id ??
    roles[0]?.id ??
    ""
  );
}

function needsManager(role?: StaffAdmitRole) {
  if (!role) return false;
  if (role.slug === "ADMIN" || role.portal === "PARENT" || role.portal === "STUDENT") return false;
  if (role.name === "Admin" || role.name === "Parent") return false;
  return true;
}

function emptyForm(roles: StaffAdmitRole[], managers: ManagerOption[]): StaffAdmitPayload {
  return {
    name: "",
    phone: "",
    roleId: suggestedRoleId(roles),
    classId: "",
    joinedOn: todayYmd(),
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    managerId: defaultManagerId(managers),
    monthlySalary: "30000",
  };
}

export function StaffAdmitForm({
  roles,
  managers,
  classes = [],
  user,
  onSubmit,
  initialValues,
  submitLabel = "Add employee",
  busyLabel = "Adding…",
  wizard,
  staffForm = [],
}: {
  /** Phone: full-screen steps (Details · Documents) driven by the staff onboarding form. */
  wizard?: boolean;
  /** The school's staff onboarding form (School setup → Forms & Templates). */
  staffForm?: AdmissionFormField[];
  roles: StaffAdmitRole[];
  managers: ManagerOption[];
  classes?: StaffAdmitClass[];
  user: { id: string; permissions: string[] } | null;
  onSubmit: (values: StaffAdmitPayload, files: StaffAdmitFiles) => Promise<void>;
  initialValues?: Partial<StaffAdmitPayload>;
  submitLabel?: string;
  busyLabel?: string;
}) {
  const sectioned = !wizard && staffForm.length > 0;
  const blank = () => ({ ...emptyForm(roles, managers), ...(wizard || sectioned ? { roleId: "", monthlySalary: "" } : {}), ...initialValues });
  const [form, setForm] = useState<StaffAdmitPayload>(blank);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<StaffAdmitFiles>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const picked = roles.find((r) => r.id === form.roleId);
  const showManager = needsManager(picked);
  const showClassTeacher = picked?.portal === "TEACHER";

  function patch(part: Partial<StaffAdmitPayload>) {
    setForm((prev) => ({ ...prev, ...part }));
  }

  useEffect(() => {
    const adminId = defaultManagerId(managers);
    if (!form.managerId && adminId) patch({ managerId: adminId });
  }, [managers]);

  useEffect(() => {
    setForm(blank());
  }, [initialValues, roles, managers]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(
        {
          ...form,
          managerId: showManager ? form.managerId || defaultManagerId(managers) : "",
          classId: showClassTeacher ? form.classId : "",
          customValues: custom,
        },
        files
      );
      setForm(blank());
      setFiles({});
      setCustom({});
      setStep(0);
    } catch {
      /* parent shows the error; keep the form */
    } finally {
      setBusy(false);
    }
  }

  if (wizard || sectioned) {
    const LOCKED = ["staffName", "phone", "role", "joiningDate"];
    const ordered = [...staffForm];
    for (const id of LOCKED) {
      if (!ordered.some((f) => f.id === id)) {
        ordered.unshift({ id, label: id === "staffName" ? "Name" : id === "phone" ? "Mobile" : id === "role" ? "Role" : "Joining date", type: "text", required: true, visible: true, options: [], builtin: true });
      }
    }
    const shown = ordered.filter((f) => f.visible || LOCKED.includes(f.id));
    const detailFields = shown.filter((f) => f.type !== "file" || f.builtin);
    const fileFields = shown.filter((f) => f.type === "file" && !f.builtin);
    const steps = ["Details", ...(fileFields.length ? ["Documents"] : [])];
    const last = !wizard || step >= steps.length - 1;
    const digits = form.phone.replace(/\D/g, "");
    const uploaded = fileFields.filter((f) => files[f.id]).length;
    const isReq = (f: AdmissionFormField) => LOCKED.includes(f.id) || f.required;
    const box = wizard
      ? "h-12 rounded-xl border border-ink-200 bg-white px-3 text-[15px] text-ink-900"
      : "h-11 rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-900";
    const staffRoles = roles.filter((r) => r.portal !== "PARENT" && r.portal !== "STUDENT");
    const label = (text: string) =>
      wizard ? (
        <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{text}</Text>
      ) : (
        <Text className="mb-1.5 text-xs font-medium text-ink-700">{text}</Text>
      );
    const title = (f: AdmissionFormField) => `${f.label}${isReq(f) ? " *" : ""}`;

    function valueMissing(f: AdmissionFormField) {
      if (f.id === "staffName") return !form.name.trim();
      if (f.id === "phone") return digits.length !== 10;
      if (f.id === "role") return !form.roleId;
      if (f.id === "joiningDate") return !form.joinedOn;
      if (f.id === "email") return !form.email.trim();
      if (f.id === "address") return !form.address.trim();
      if (f.type === "file") return !files[f.id];
      return !String(custom[f.id] || "").trim();
    }

    function missing(name: string) {
      const list = name === "Documents" ? fileFields : name === "Details" ? detailFields : shown;
      const hit = list.find((f) => isReq(f) && valueMissing(f));
      if (!hit) return "";
      return hit.id === "phone" ? "A 10-digit mobile number" : hit.label;
    }

    function next() {
      const miss = wizard ? missing(steps[step]) : missing("all");
      if (miss) {
        setError(`${miss} is required.`);
        return;
      }
      setError("");
      if (last) void save();
      else setStep((n) => n + 1);
    }

    const renderField = (f: AdmissionFormField) => {
      if (f.id === "staffName") {
        return (
          <View>
            {label(title(f))}
            <TextInput value={form.name} onChangeText={(name) => patch({ name })} autoComplete="name" placeholder="Full name" placeholderTextColor="#94a3b8" className={box} style={{ includeFontPadding: false }} />
          </View>
        );
      }
      if (f.id === "phone") {
        return (
          <View>
            {label(title(f))}
            <View className={`flex-row items-center border border-ink-200 bg-white ${wizard ? "h-12 rounded-xl" : "h-11 rounded-md"}`}>
              <View className="h-full justify-center border-r border-ink-200 bg-ink-50 px-3">
                <Text className={`${wizard ? "text-[15px]" : "text-sm"} font-medium text-ink-600`}>+91</Text>
              </View>
              <TextInput
                value={form.phone}
                onChangeText={(phone) => patch({ phone: phone.replace(/[^\d]/g, "").slice(0, 10) })}
                keyboardType="phone-pad"
                placeholder="10-digit mobile"
                placeholderTextColor="#94a3b8"
                className={`h-full flex-1 px-3 ${wizard ? "text-[15px]" : "text-sm"} text-ink-900`}
                style={{ includeFontPadding: false }}
              />
              {digits.length === 10 ? <Ionicons name="checkmark-circle" size={18} color="#16a34a" style={{ marginRight: 12 }} /> : null}
            </View>
            <Text className="mt-1 text-xs text-ink-500">They sign in with this number.</Text>
          </View>
        );
      }
      if (f.id === "role") {
        return (
          <View className="gap-3">
            <View>
              {label(title(f))}
              <View className="flex-row flex-wrap gap-2">
                {staffRoles.map((r) => {
                  const on = form.roleId === r.id;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => patch({ roleId: r.id, classId: r.portal === "TEACHER" ? form.classId : "" })}
                      className={`h-9 justify-center rounded-full border px-4 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                    >
                      <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{r.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {showClassTeacher && classes.length ? (
              <View>
                {label("Class teacher of")}
                <View className="flex-row flex-wrap gap-2">
                  {[{ id: "", label: "None" }, ...classes].map((c) => {
                    const on = form.classId === c.id;
                    return (
                      <Pressable key={c.id || "none"} onPress={() => patch({ classId: c.id })} className={`rounded-full border px-3 py-1.5 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}>
                        <Text className={`text-sm font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{c.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        );
      }
      if (f.id === "joiningDate") {
        return (
          <View>
            {label(title(f))}
            <DateField value={form.joinedOn} onChange={(joinedOn) => patch({ joinedOn })} />
          </View>
        );
      }
      if (f.id === "email") {
        return (
          <View>
            {label(title(f))}
            <TextInput value={form.email} onChangeText={(email) => patch({ email })} autoCapitalize="none" keyboardType="email-address" placeholder="name@email.com" placeholderTextColor="#94a3b8" className={box} style={{ includeFontPadding: false }} />
          </View>
        );
      }
      if (f.id === "address") {
        return (
          <View>
            {label(title(f))}
            <TextInput value={form.address} onChangeText={(address) => patch({ address })} placeholder="House, street, area, city" placeholderTextColor="#94a3b8" className={box} style={{ includeFontPadding: false }} />
          </View>
        );
      }
      if (["text", "number", "email", "phone"].includes(f.type)) {
        return (
          <View>
            {label(title(f))}
            <TextInput
              value={custom[f.id] || ""}
              onChangeText={(v) => setCustom((c) => ({ ...c, [f.id]: v }))}
              keyboardType={f.type === "number" || f.type === "phone" ? "number-pad" : f.type === "email" ? "email-address" : "default"}
              autoCapitalize={f.type === "email" ? "none" : "sentences"}
              placeholder={f.helpText || ""}
              placeholderTextColor="#94a3b8"
              className={box}
              style={{ includeFontPadding: false }}
            />
          </View>
        );
      }
      return (
        <AdmissionCustomField
          field={{ ...f, required: isReq(f) }}
          value={custom[f.id] || ""}
          onChange={(v) => setCustom((c) => ({ ...c, [f.id]: v }))}
          onFile={() => undefined}
        />
      );
    };

    const docsGrid = (
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {fileFields.map((f) => {
          const file = files[f.id];
          const image = Boolean(file && file.type.startsWith("image/"));
          return (
            <Pressable
              key={f.id}
              onPress={async () => {
                const picked = await pickFile(fileAccept(f)).catch(() => null);
                if (picked) {
                  setError("");
                  setFiles((prev) => ({ ...prev, [f.id]: picked }));
                }
              }}
              style={{ width: "48.5%", height: 156 }}
              className={`overflow-hidden rounded-2xl ${file ? "border border-emerald-300 bg-white" : "border-2 border-dashed border-ink-200 bg-white"}`}
            >
              {image && file ? (
                <Image source={{ uri: file.uri }} style={{ width: "100%", height: 104 }} resizeMode="cover" />
              ) : (
                <View className={`h-[104px] items-center justify-center ${file ? "bg-emerald-50" : "bg-ink-50/60"}`}>
                  <View className={`h-12 w-12 items-center justify-center rounded-full ${file ? "bg-white" : "bg-[#EEF3FF]"}`}>
                    <Ionicons name={file ? "document-text" : f.fileType === "image" ? "camera-outline" : "cloud-upload-outline"} size={22} color={file ? "#047857" : "#1F45C7"} />
                  </View>
                  {!file ? <Text className="mt-1.5 text-[11px] font-semibold text-[#1F45C7]">Tap to upload</Text> : null}
                </View>
              )}
              {file ? (
                <View className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-full bg-emerald-600">
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              ) : null}
              <View className="flex-1 justify-center px-2.5">
                <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                  {f.label}
                  {f.required ? <Text className="text-red-600"> *</Text> : null}
                </Text>
                <Text className={`text-[11px] ${file ? "text-emerald-700" : "text-ink-500"}`} numberOfLines={1}>
                  {file ? `${file.name} · Change` : f.required ? "Required" : "Optional"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );

    const errorBox = error ? (
      <View className="flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
        <Ionicons name="alert-circle-outline" size={16} color="#b91c1c" />
        <Text className="flex-1 text-sm text-red-700">{error}</Text>
      </View>
    ) : null;

    if (sectioned) {
      let n = 0;
      return (
        <View className="gap-4">
          <SectionCard step={++n} title="Employee details" subtitle="Follows your staff onboarding form in Forms & Templates.">
            <View className="flex-row flex-wrap justify-between gap-y-4">
              {detailFields.map((f) => {
                const full = f.id === "role" || f.id === "address" || ["textarea", "multi", "checkbox"].includes(f.type);
                return (
                  <View key={f.id} style={{ width: full ? "100%" : "48.5%" }}>
                    {renderField(f)}
                  </View>
                );
              })}
            </View>
          </SectionCard>
          {fileFields.length ? (
            <SectionCard
              step={++n}
              title="Documents"
              subtitle="Saved privately to the employee's file."
              aside={<Text className={`text-xs font-semibold ${uploaded === fileFields.length ? "text-emerald-700" : "text-ink-600"}`}>{uploaded}/{fileFields.length} added</Text>}
            >
              <View className="flex-row flex-wrap justify-between gap-y-3">
                {fileFields.map((f) => (
                  <View key={f.id} style={{ width: "48.5%" }}>
                    <UploadTile
                      field={f}
                      file={files[f.id]}
                      onPick={(file) => {
                        setError("");
                        setFiles((prev) => ({ ...prev, [f.id]: file }));
                      }}
                      onRemove={() =>
                        setFiles((prev) => {
                          const next = { ...prev };
                          delete next[f.id];
                          return next;
                        })
                      }
                    />
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : null}
          <View className="gap-2 border-t border-ink-100 pt-3">
            {errorBox}
            <View className="flex-row flex-wrap items-center justify-between gap-3">
              <Text className="text-xs text-ink-600">Employee ID is assigned automatically. Salary and manager are set later in Edit employee.</Text>
              <Button className="min-w-[160px]" onPress={next}>
                {busy ? busyLabel : submitLabel}
              </Button>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View className="min-h-0 flex-1">
        {steps.length > 1 ? (
          <View className="px-4 pb-3 pt-1">
            <View className="relative flex-row">
              <View className="absolute h-0.5 bg-ink-200" style={{ top: 15, left: "25%", right: "25%" }} />
              {step > 0 ? <View className="absolute h-0.5 bg-[#1F45C7]" style={{ top: 15, left: "25%", right: "25%" }} /> : null}
              {steps.map((name, i) => (
                <View key={name} className="flex-1 items-center">
                  <View className={`h-8 w-8 items-center justify-center rounded-full ${i < step ? "bg-[#1F45C7]" : i === step ? "border-2 border-[#1F45C7] bg-white" : "border border-ink-300 bg-white"}`}>
                    {i < step ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text className={`text-sm font-bold ${i === step ? "text-[#1F45C7]" : "text-ink-500"}`}>{i + 1}</Text>}
                  </View>
                  <Text className={`mt-1.5 text-xs ${i === step ? "font-semibold text-[#1F45C7]" : "text-ink-500"}`}>{name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          {steps[step] === "Details" ? detailFields.map((f) => <View key={f.id}>{renderField(f)}</View>) : null}
          {steps[step] === "Documents" ? (
            <>
              <View className="flex-row items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
                <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
                  <Text className="text-xs font-bold text-[#1F45C7]">{uploaded}/{fileFields.length}</Text>
                </View>
                <Text className="flex-1 text-sm text-ink-700">Clear photo or PDF · tap a card to upload</Text>
              </View>
              {docsGrid}
            </>
          ) : null}
        </ScrollView>
        <View className="gap-2 border-t border-ink-100 bg-white px-4 pb-2 pt-3">
          {errorBox}
          <View className="flex-row gap-2">
            {step > 0 ? (
              <Pressable onPress={() => { setError(""); setStep((n) => n - 1); }} className="h-12 flex-1 items-center justify-center rounded-xl border border-ink-200">
                <Text className="text-[15px] font-semibold text-ink-800">Back</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={busy} onPress={next} className={`h-12 flex-[2] items-center justify-center rounded-xl ${busy ? "bg-ink-300" : "bg-[#1F45C7]"}`}>
              <Text className="text-[15px] font-semibold text-white">{busy ? busyLabel : last ? submitLabel : `Next · ${steps[step + 1]}`}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-3 rounded-md border border-ink-100 bg-ink-50 p-3">
        <Text className="text-xs font-semibold uppercase text-ink-700">Login and access</Text>
        <View className="gap-3 sm:flex-row">
          <View className="flex-1">
            <Field label="Name">
              <Input value={form.name} onChangeText={(name) => patch({ name })} autoComplete="name" />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Mobile">
              <Input keyboardType="phone-pad" value={form.phone} onChangeText={(phone) => patch({ phone })} />
            </Field>
          </View>
        </View>
        <View className="gap-3 sm:flex-row">
          <View className="flex-1">
            <Dropdown
              label="Role"
              value={form.roleId}
              options={roles.map((r) => ({ id: r.id, label: r.name, group: r.portal || "Role" }))}
              onChange={(roleId) =>
                patch({ roleId, classId: roles.find((r) => r.id === roleId)?.portal === "TEACHER" ? form.classId : "" })
              }
              placeholder="Pick a role"
            />
          </View>
          {showClassTeacher ? (
            <View className="flex-1">
              <Dropdown
                label="Class teacher of"
                value={form.classId}
                options={[{ id: "", label: "Not a class teacher" }, ...classes.map((c) => ({ id: c.id, label: c.label }))]}
                onChange={(classId) => patch({ classId })}
                placeholder="Choose class"
              />
            </View>
          ) : null}
        </View>
        {showManager ? (
          <ManagerSelect
            user={user}
            managers={managers}
            value={form.managerId || defaultManagerId(managers)}
            onPick={(managerId) => patch({ managerId })}
          />
        ) : null}
      </View>
      <View className="gap-3 rounded-md border border-ink-100 p-3">
        <Text className="text-xs font-semibold uppercase text-ink-700">Employment</Text>
        <View className="gap-3 sm:flex-row">
          <View className="flex-1">
            <Field label="Joining date">
              <DateField value={form.joinedOn} onChange={(joinedOn) => patch({ joinedOn })} />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Monthly salary">
              <Input
                keyboardType="number-pad"
                value={form.monthlySalary}
                onChangeText={(monthlySalary) => patch({ monthlySalary })}
                placeholder="30000"
              />
            </Field>
          </View>
        </View>
      </View>
      <Text className="text-xs text-ink-700">
        They log in with this mobile. First password is set for them — they change it on Profile.
      </Text>
      <View className="gap-3 rounded-md border border-ink-100 p-3">
        <Text className="text-xs font-semibold uppercase text-ink-700">Optional profile</Text>
        <Field label="Email">
          <Input autoCapitalize="none" value={form.email} onChangeText={(email) => patch({ email })} />
        </Field>
        <Field label="Address">
          <Input value={form.address} onChangeText={(address) => patch({ address })} />
        </Field>
        <View className="gap-3 sm:flex-row">
          <View className="flex-1">
            <Field label="City">
              <Input value={form.city} onChangeText={(city) => patch({ city })} />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="State">
              <Input value={form.state} onChangeText={(state) => patch({ state })} />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="PIN">
              <Input keyboardType="number-pad" value={form.pincode} onChangeText={(pincode) => patch({ pincode })} />
            </Field>
          </View>
        </View>
      </View>
      <Button onPress={save}>{busy ? busyLabel : submitLabel}</Button>
    </View>
  );
}
