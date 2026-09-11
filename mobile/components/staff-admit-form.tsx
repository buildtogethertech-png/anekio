import { useEffect, useState } from "react";
import { Text, View } from "react-native";
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
};

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
}: {
  roles: StaffAdmitRole[];
  managers: ManagerOption[];
  classes?: StaffAdmitClass[];
  user: { id: string; permissions: string[] } | null;
  onSubmit: (values: StaffAdmitPayload) => Promise<void>;
  initialValues?: Partial<StaffAdmitPayload>;
  submitLabel?: string;
  busyLabel?: string;
}) {
  const [form, setForm] = useState(() => ({ ...emptyForm(roles, managers), ...initialValues }));
  const [busy, setBusy] = useState(false);
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
    setForm({ ...emptyForm(roles, managers), ...initialValues });
  }, [initialValues, roles, managers]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit({
        ...form,
        managerId: showManager ? form.managerId || defaultManagerId(managers) : "",
        classId: showClassTeacher ? form.classId : "",
      });
      setForm({ ...emptyForm(roles, managers), ...initialValues });
    } catch {
      /* parent shows the error; keep the form */
    } finally {
      setBusy(false);
    }
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
