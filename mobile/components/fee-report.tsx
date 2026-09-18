import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Chip } from "./ui";
import { inr } from "../lib/payroll";
import { useRecord } from "../lib/record";

type Person = NonNullable<ReturnType<typeof useRecord>["data"]>["people"] extends (infer P)[] | undefined ? P : never;
type Klass = NonNullable<ReturnType<typeof useRecord>["data"]>["classes"] extends (infer C)[] | undefined ? C : never;

function moneyNumber(value?: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function compactInr(amount: number) {
  const rounded = Math.round(amount || 0);
  if (Math.abs(rounded) >= 100000) {
    const lakhs = rounded / 100000;
    const digits = Math.abs(lakhs) >= 10 ? 1 : 2;
    return `₹${lakhs.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")}L`;
  }
  return inr(rounded);
}

function FeeHealthTile({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "leaf" | "warn" | "danger";
}) {
  const toneClass =
    tone === "leaf" ? "text-green-700" : tone === "warn" ? "text-amber-800" : tone === "danger" ? "text-red-700" : "text-ink-900";
  return (
    <View className="min-w-[150px] flex-1 rounded-md border border-ink-100 bg-white px-3 py-3">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-700">{label}</Text>
      <Text className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</Text>
      <Text className="mt-1 text-xs leading-4 text-ink-700">{hint}</Text>
    </View>
  );
}

function FeeBarRow({
  label,
  value,
  max,
  detail,
  tone = "blue",
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
  tone?: "blue" | "amber" | "red" | "green";
}) {
  const width = max > 0 ? Math.max(5, Math.round((value / max) * 100)) : 0;
  const bar = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : tone === "green" ? "bg-emerald-500" : "bg-blue-500";
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 text-xs font-medium text-ink-900" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-xs text-ink-700">{detail}</Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-ink-100">
        {value > 0 ? <View className={`h-full rounded-full ${bar}`} style={{ width: `${width}%` }} /> : null}
      </View>
    </View>
  );
}

function FeeHealthChart({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View className="min-w-[260px] flex-1 rounded-md border border-ink-100 bg-white p-3">
      <View className="mb-3">
        <Text className="text-sm font-semibold text-ink-900">{title}</Text>
        <Text className="mt-0.5 text-xs leading-4 text-ink-700">{subtitle}</Text>
      </View>
      <View className="gap-3">{children}</View>
    </View>
  );
}

export function FeeReport({
  people,
  classes,
  onOpenStudent,
}: {
  people: Person[];
  classes: Klass[];
  sessions?: { id: string; label: string; startsOn: string; endsOn: string; current: boolean }[];
  refreshing?: boolean;
  onOpenPayment?: (row: { id: string; invoiceUrl?: string; receiptUrl?: string }, paid: boolean) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [classId, setClassId] = useState("all");
  const selectedClass = classes.find((row) => row.id === classId);
  const reportPeople = classId === "all" ? people : people.filter((person) => person.classId === classId);
  const reportDueStudents = reportPeople.filter((person) => (person.dueAmount || 0) > 0);
  const reportOverdueStudents = reportDueStudents.filter((person) => (person.overdueCount || 0) > 0);
  const reportClasses = classId === "all" ? classes : classes.filter((row) => row.id === classId);

  const allInvoices = reportPeople.flatMap((person) =>
    (person.invoices ?? []).map((inv) => ({
      ...inv,
      studentId: person.id,
      classId: person.classId || "",
      dueNowAmount: inv.dueNow ?? moneyNumber(inv.remaining),
    }))
  );
  const openInvoices = allInvoices.filter((inv) => inv.status !== "paid" && inv.dueNowAmount > 0);
  const overdueInvoices = openInvoices.filter((inv) => inv.status === "overdue");
  const billed = reportPeople.reduce((sum, person) => sum + moneyNumber(person.billed), 0);
  const paid = reportPeople.reduce((sum, person) => sum + moneyNumber(person.paid), 0);
  const outstanding = reportDueStudents.reduce((sum, person) => sum + (person.dueAmount || 0), 0);
  const overdue = overdueInvoices.reduce((sum, inv) => sum + inv.dueNowAmount, 0);
  const collectionRate = ratio(paid, billed);
  const currentDue = Math.max(0, outstanding - overdue);
  const maxCollectionBar = Math.max(billed, paid, outstanding, 1);

  const classHealth = reportClasses
    .map((klass) => {
      const rows = reportPeople.filter((person) => person.classId === klass.id);
      const classInvoices = openInvoices.filter((inv) => inv.classId === klass.id);
      const classBilled = rows.reduce((sum, person) => sum + moneyNumber(person.billed), 0);
      const classPaid = rows.reduce((sum, person) => sum + moneyNumber(person.paid), 0);
      const classOutstanding = rows.reduce((sum, person) => sum + (person.dueAmount || 0), 0);
      const classOverdue = classInvoices.filter((inv) => inv.status === "overdue").reduce((sum, inv) => sum + inv.dueNowAmount, 0);
      return {
        id: klass.id,
        label: klass.label,
        students: rows.length,
        outstanding: classOutstanding,
        overdue: classOverdue,
        collectionRate: ratio(classPaid, classBilled),
      };
    })
    .filter((row) => row.students > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.label.localeCompare(b.label));
  const maxClassOutstanding = Math.max(...classHealth.map((row) => row.outstanding), 1);

  const pendingBuckets = useMemo(() => {
    const buckets = [
      { label: "1 month", count: 0 },
      { label: "2 months", count: 0 },
      { label: "3+ months", count: 0 },
    ];
    for (const person of reportDueStudents) {
      const openMonths = new Set(
        (person.invoices ?? [])
          .filter((inv) => inv.status !== "paid" && (inv.dueNow ?? moneyNumber(inv.remaining)) > 0)
          .map((inv) => inv.period || inv.title)
      );
      const count = openMonths.size;
      if (count >= 3) buckets[2].count += 1;
      else if (count === 2) buckets[1].count += 1;
      else if (count === 1) buckets[0].count += 1;
    }
    return buckets;
  }, [reportDueStudents]);
  const maxPendingBucket = Math.max(...pendingBuckets.map((row) => row.count), 1);

  const topFollowUps = reportDueStudents
    .slice()
    .sort((a, b) => (b.overdueCount || 0) - (a.overdueCount || 0) || (b.dueAmount || 0) - (a.dueAmount || 0))
    .slice(0, 5);

  function monthsOf(person: Person) {
    return (person.invoices ?? []).filter((inv) => inv.status !== "paid").length;
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
      <View className="mb-3 flex-row flex-wrap gap-1.5">
        <Chip label="All classes" active={classId === "all"} onPress={() => setClassId("all")} />
        {classes.map((klass) => (
          <Chip key={klass.id} label={klass.label} active={classId === klass.id} onPress={() => setClassId(klass.id)} />
        ))}
      </View>

      <View className="gap-3 rounded-md border border-ink-100 bg-ink-50 p-3">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-ink-900">{selectedClass ? `${selectedClass.label} fee health` : "Fee health"}</Text>
            <Text className="mt-1 text-sm leading-5 text-ink-700">
              Collection, overdue pressure, class exposure, and the students finance should call first.
            </Text>
          </View>
          <View className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-blue-900">Collection rate</Text>
            <Text className="text-xl font-semibold text-blue-950">{collectionRate}%</Text>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2">
          <FeeHealthTile label="Billed" value={compactInr(billed)} hint={`${allInvoices.length} invoices raised`} />
          <FeeHealthTile label="Collected" value={compactInr(paid)} hint={`${collectionRate}% of billed`} tone="leaf" />
          <FeeHealthTile
            label="Outstanding"
            value={compactInr(outstanding)}
            hint={`${reportDueStudents.length} students pending`}
            tone={outstanding ? "warn" : "leaf"}
          />
          <FeeHealthTile
            label="Overdue"
            value={compactInr(overdue)}
            hint={`${reportOverdueStudents.length} students crossed due date`}
            tone={overdue ? "danger" : "leaf"}
          />
        </View>

        <View className={`gap-3 ${compact ? "" : "flex-row"}`}>
          <FeeHealthChart title="Collection funnel" subtitle="How billed fees are converting into cash.">
            <FeeBarRow label="Billed" value={billed} max={maxCollectionBar} detail={compactInr(billed)} tone="blue" />
            <FeeBarRow label="Collected" value={paid} max={maxCollectionBar} detail={compactInr(paid)} tone="green" />
            <FeeBarRow label="Outstanding" value={outstanding} max={maxCollectionBar} detail={compactInr(outstanding)} tone="amber" />
          </FeeHealthChart>
          <FeeHealthChart title="Outstanding mix" subtitle="Split between fresh dues and overdue money.">
            <FeeBarRow label="Current due" value={currentDue} max={Math.max(outstanding, 1)} detail={compactInr(currentDue)} tone="amber" />
            <FeeBarRow label="Overdue" value={overdue} max={Math.max(outstanding, 1)} detail={compactInr(overdue)} tone="red" />
            <View className="rounded-md bg-ink-50 px-3 py-2">
              <Text className="text-xs font-medium text-ink-900">{openInvoices.length} open invoices</Text>
              <Text className="mt-0.5 text-xs text-ink-700">{overdueInvoices.length} overdue invoices need follow-up.</Text>
            </View>
          </FeeHealthChart>
        </View>

        <View className={`gap-3 ${compact ? "" : "flex-row"}`}>
          <FeeHealthChart title="Class exposure" subtitle="Classes ranked by unpaid amount.">
            {classHealth.length ? (
              classHealth.slice(0, 6).map((row) => (
                <FeeBarRow
                  key={row.id}
                  label={row.label}
                  value={row.outstanding}
                  max={maxClassOutstanding}
                  detail={`${compactInr(row.outstanding)} · ${row.collectionRate}% paid`}
                  tone={row.overdue > 0 ? "red" : "amber"}
                />
              ))
            ) : (
              <Text className="text-sm text-ink-700">No class exposure yet.</Text>
            )}
          </FeeHealthChart>
          <FeeHealthChart title="Pending depth" subtitle="How long students have unpaid fee months.">
            {pendingBuckets.map((row) => (
              <FeeBarRow
                key={row.label}
                label={row.label}
                value={row.count}
                max={maxPendingBucket}
                detail={`${row.count} students`}
                tone={row.label === "3+ months" ? "red" : row.label === "2 months" ? "amber" : "blue"}
              />
            ))}
            <View className="rounded-md bg-ink-50 px-3 py-2">
              <Text className="text-xs font-medium text-ink-900">{reportPeople.length - reportDueStudents.length} students clear</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Use this to see whether dues are shallow or turning into backlog.</Text>
            </View>
          </FeeHealthChart>
          <FeeHealthChart title="Priority follow-ups" subtitle="Highest-risk accounts for finance.">
            {topFollowUps.length ? (
              topFollowUps.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  onPress={() => onOpenStudent(person.id)}
                  className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-semibold text-ink-900" numberOfLines={1}>
                        {person.name} · {person.classLabel}
                      </Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        {monthsOf(person)} pending · {person.overdueCount || 0} overdue
                      </Text>
                    </View>
                    <Text className="text-xs font-semibold text-amber-800">{compactInr(person.dueAmount || 0)}</Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Text className="text-sm text-ink-700">No follow-ups pending.</Text>
            )}
          </FeeHealthChart>
        </View>
      </View>
    </ScrollView>
  );
}
