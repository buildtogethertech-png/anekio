import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DateField } from "./date-field";
import { Dropdown } from "./form";
import { defaultManagerId, ManagerSelect, type ManagerOption } from "./manager-picker";
import { Button, Field, Input } from "./ui";

export type StaffAdmitRole = { id: string; name: string; portal?: string; slug?: string; isSystem?: boolean };

export type StaffAdmitPayload = {
  name: string;
  phone: string;
  roleId: string;
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
  user,
  onSubmit,
  initialValues,
  submitLabel = "Add employee",
  busyLabel = "Adding…",
}: {
  roles: StaffAdmitRole[];
  managers: ManagerOption[];
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
      });
      setForm({ ...emptyForm(roles, managers), ...initialValues });
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
      <Field label="Mobile">
        <Input keyboardType="phone-pad" value={form.phone} onChangeText={(phone) => patch({ phone })} />
      </Field>
      <Dropdown
        label="Role"
        value={form.roleId}
        options={roles.map((r) => ({ id: r.id, label: r.name }))}
        onChange={(roleId) => patch({ roleId })}
        placeholder="Pick a role"
      />
      {showManager ? (
        <ManagerSelect
          user={user}
          managers={managers}
          value={form.managerId || defaultManagerId(managers)}
          onPick={(managerId) => patch({ managerId })}
        />
      ) : null}
      <Field label="Joining date">
        <DateField value={form.joinedOn} onChange={(joinedOn) => patch({ joinedOn })} />
      </Field>
      <Field label="Monthly salary">
        <Input
          keyboardType="number-pad"
          value={form.monthlySalary}
          onChangeText={(monthlySalary) => patch({ monthlySalary })}
          placeholder="30000"
        />
      </Field>
      <Text className="text-xs text-ink-700">
        They log in with this mobile. First password is set for them — they change it on Profile.
      </Text>
      <Text className="pt-1 text-xs font-medium text-ink-700">Optional</Text>
      <Field label="Email">
        <Input autoCapitalize="none" value={form.email} onChangeText={(email) => patch({ email })} />
      </Field>
      <Field label="Address">
        <Input value={form.address} onChangeText={(address) => patch({ address })} />
      </Field>
      <Field label="City">
        <Input value={form.city} onChangeText={(city) => patch({ city })} />
      </Field>
      <Field label="State">
        <Input value={form.state} onChangeText={(state) => patch({ state })} />
      </Field>
      <Field label="PIN">
        <Input keyboardType="number-pad" value={form.pincode} onChangeText={(pincode) => patch({ pincode })} />
      </Field>
      <Button onPress={save}>{busy ? busyLabel : submitLabel}</Button>
    </View>
  );
}
