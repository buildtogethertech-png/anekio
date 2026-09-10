import { View } from "react-native";
import { Dropdown } from "./form";
import { Chip } from "./ui";

export type ManagerOption = { id: string; name: string; role: string; slug?: string; portal?: string };

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

export function canChangeManager(user: { id: string; permissions: string[] } | null, managerId?: string) {
  return can(user, "staff.edit") || Boolean(user?.id && managerId && user.id === managerId);
}

export function managerChoices(user: { id: string; permissions: string[] } | null, managers: ManagerOption[]) {
  if (can(user, "staff.edit")) return managers;
  const admin = managers.find((m) => m.slug === "ADMIN" || m.role === "Admin");
  const ids = new Set([user?.id, admin?.id].filter(Boolean) as string[]);
  return managers.filter((m) => ids.has(m.id));
}

export function defaultManagerId(managers: ManagerOption[]) {
  return managers.find((m) => m.slug === "ADMIN")?.id || managers.find((m) => m.role === "Admin")?.id || "";
}

function orderedManagers(user: { id: string; permissions: string[] } | null, managers: ManagerOption[]) {
  return [...managerChoices(user, managers)].sort(
    (a, b) =>
      Number(b.slug === "ADMIN" || b.role === "Admin") - Number(a.slug === "ADMIN" || a.role === "Admin") ||
      a.name.localeCompare(b.name)
  );
}

export function ManagerSelect({
  managers,
  value,
  onPick,
  user,
  label = "Reports to",
}: {
  managers: ManagerOption[];
  value?: string;
  onPick: (id: string) => void;
  user: { id: string; permissions: string[] } | null;
  label?: string;
}) {
  const list = orderedManagers(user, managers);
  const fallback = defaultManagerId(list) || list[0]?.id || "";
  if (!list.length) return null;
  return (
    <Dropdown
      label={label}
      value={value || fallback}
      options={list.map((m) => ({
        id: m.id,
        label: m.role ? `${m.name} · ${m.role}` : m.name,
        searchText: `${m.name} ${m.role || ""}`,
      }))}
      onChange={onPick}
      placeholder="Admin"
    />
  );
}

export function ManagerPicker({
  managers,
  value,
  onPick,
  user,
}: {
  managers: ManagerOption[];
  value?: string;
  onPick: (id: string) => void;
  user: { id: string; permissions: string[] } | null;
}) {
  const list = managerChoices(user, managers);
  if (!list.length) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {list.map((m) => (
        <Chip key={m.id} label={m.name} active={value === m.id} onPress={() => onPick(m.id)} />
      ))}
    </View>
  );
}
