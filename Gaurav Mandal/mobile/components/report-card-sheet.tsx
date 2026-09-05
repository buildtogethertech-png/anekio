import { Image, Platform, Pressable, Text, View } from "react-native";
import { apiBase } from "../lib/api";
import {
  attendancePct,
  seriesRanks,
  studentSeriesScore,
  type GradePolicy,
  type SeriesExam,
  type SeriesMark,
} from "../lib/exams";

export type ReportCardData = {
  school: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    affiliation?: string;
    logoPath?: string;
    signPath?: string;
    stampPath?: string;
    signatory?: string;
    invoiceStyle?: string;
  };
  seriesName: string;
  sessionLabel: string;
  classLabel: string;
  student: {
    id: string;
    name: string;
    admissionNo?: string;
    parentName?: string;
    attendance?: { status: string }[];
  };
  classmates: { id: string; name: string }[];
  exams: SeriesExam[];
  marks: SeriesMark[];
  policy: GradePolicy;
};

function assetUrl(rel?: string) {
  if (!rel) return "";
  return `${apiBase()}/api/files/${rel}`;
}

function schoolLines(school: ReportCardData["school"]) {
  const street = (school.address || "").trim();
  const place = [school.city, school.state, school.pincode].map((p) => (p || "").trim()).filter(Boolean).join(" ");
  return [street, place, school.phone && `Tel ${school.phone}`, school.email].filter(Boolean) as string[];
}

export function ReportCardSheet({
  data,
  print = true,
  printLabel = "Print / PDF",
  onPrint,
}: {
  data: ReportCardData;
  print?: boolean;
  printLabel?: string;
  onPrint?: () => void;
}) {
  const score = studentSeriesScore(data.student.id, data.exams, data.marks, data.policy);
  const ranks = data.policy.showRank
    ? seriesRanks(data.classmates, data.exams, data.marks, data.policy)
    : new Map<string, number>();
  const rank = ranks.get(data.student.id);
  const att = attendancePct(data.student.attendance ?? []);
  const place = schoolLines(data.school);
  const logo = assetUrl(data.school.logoPath);
  const sign = assetUrl(data.school.signPath);
  const stamp = assetUrl(data.school.stampPath);
  const compact = data.school.invoiceStyle === "compact";
  const formal = data.school.invoiceStyle === "formal";

  return (
    <View className="bg-white">
      {print && Platform.OS === "web" ? (
        <View className="mb-4 items-end">
          <Pressable
            onPress={() => {
              if (onPrint) {
                onPrint();
                return;
              }
              if (typeof window !== "undefined") window.print();
            }}
            className="rounded-md border border-ink-200 px-3 py-2"
          >
            <Text className="text-sm font-medium text-ink-800">{printLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      <View className={`overflow-hidden rounded-lg border ${formal ? "border-clay-500" : "border-ink-200"}`}>
        <View className="flex-row items-center gap-4 bg-clay-500 px-5 py-4">
          {logo ? (
            <View className="h-16 w-16 items-center justify-center rounded-md bg-white p-1">
              <Image source={{ uri: logo }} className="h-full w-full" resizeMode="contain" />
            </View>
          ) : (
            <View className="h-16 w-16 items-center justify-center rounded-md bg-white">
              <Text className="text-2xl font-semibold text-clay-600">{(data.school.name || "S").slice(0, 1)}</Text>
            </View>
          )}
          <View className="min-w-0 flex-1">
            <Text className="text-xl font-semibold text-white">{data.school.name || "School"}</Text>
            {place.length ? <Text className="mt-1 text-xs leading-4 text-white/80">{place.join(" · ")}</Text> : null}
            {data.school.affiliation ? <Text className="mt-0.5 text-xs font-medium text-white/90">{data.school.affiliation}</Text> : null}
          </View>
        </View>
        <View className={compact ? "p-4" : "p-5"}>
          <View className="items-center">
            <Text className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-clay-600">
              {data.seriesName} · {data.sessionLabel}
            </Text>
            <Text className="mt-2 text-2xl font-semibold text-ink-900">Progress report</Text>
          </View>

          <View className="mt-5 flex-row flex-wrap overflow-hidden rounded-md border border-ink-200 bg-ink-50">
            {[
              ["Student", data.student.name],
              ["Class", data.classLabel],
              ["Admission no.", data.student.admissionNo || "—"],
              ["Parent", data.student.parentName || "—"],
            ].map(([label, value]) => (
              <View key={label} className="w-1/2 border-b border-ink-100 px-3 py-2.5">
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">{label}</Text>
                <Text className="mt-0.5 text-sm font-medium text-ink-900">{value}</Text>
              </View>
            ))}
          </View>

          <View className="mt-5 overflow-hidden rounded-md border border-ink-200">
            <View className="flex-row bg-ink-900 px-3 py-2.5">
              <Text className="flex-[1.4] text-[10px] font-medium uppercase tracking-wide text-white">Subject</Text>
              <Text className="w-14 text-right text-[10px] font-medium uppercase tracking-wide text-white">Marks</Text>
              <Text className="w-12 text-right text-[10px] font-medium uppercase tracking-wide text-white">Max</Text>
              <Text className="w-12 text-right text-[10px] font-medium uppercase tracking-wide text-white">%</Text>
              <Text className="flex-1 pl-3 text-[10px] font-medium uppercase tracking-wide text-white">Remark</Text>
            </View>
            {score.rows.map((row, index) => (
              <View key={row.examId} className={`flex-row px-3 py-2.5 ${index ? "border-t border-ink-100" : ""}`}>
                <Text className="flex-[1.4] text-sm font-medium text-ink-900">{row.subject}</Text>
                <Text className="w-14 text-right text-sm text-ink-900">{row.missing ? "—" : row.absent ? "Ab" : row.marks}</Text>
                <Text className="w-12 text-right text-sm text-ink-700">{row.maxMarks}</Text>
                <Text className="w-12 text-right text-sm text-ink-900">{row.missing || row.absent ? "—" : `${row.pct}`}</Text>
                <Text className="flex-1 pl-3 text-sm text-ink-700">{row.remarks || "—"}</Text>
              </View>
            ))}
          </View>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {[
              ["Total", score.entered ? `${score.total} / ${score.max}` : "—"],
              ["Percentage", score.entered ? `${score.pct}%` : "—"],
              ["Grade", score.grade || "—"],
              ...(att != null ? [["Attendance", `${att}%`]] : []),
              ...(rank ? [["Rank", String(rank)]] : []),
            ].map(([label, value]) => (
              <View key={label} className="min-w-[112px] flex-1 rounded-md bg-ink-50 px-3 py-2.5">
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">{label}</Text>
                <Text className="mt-1 text-base font-semibold text-ink-900">{value}</Text>
              </View>
            ))}
          </View>

          <View className={`mt-3 rounded-md px-4 py-3 ${score.entered && score.passed ? "bg-emerald-50" : score.entered ? "bg-amber-50" : "bg-ink-50"}`}>
            <Text className={`text-center text-sm font-semibold ${score.entered && score.passed ? "text-green-700" : score.entered ? "text-amber-800" : "text-ink-700"}`}>
              {score.entered ? (score.passed ? "Promising progress — Pass" : "More support recommended") : "Marks are pending"}
            </Text>
          </View>

          <View className="mt-10 flex-row items-end justify-between gap-8">
            <View className="w-40 items-center">
              <View className="h-px w-full bg-ink-300" />
              <Text className="mt-2 text-xs text-ink-700">Class teacher</Text>
            </View>
            <View className="flex-row items-end gap-2">
              {formal && stamp ? <Image source={{ uri: stamp }} className="h-14 w-14" resizeMode="contain" /> : null}
              <View className="w-44 items-center">
                {sign ? <Image source={{ uri: sign }} className="h-12 w-full" resizeMode="contain" /> : <View className="h-12" />}
                <View className="h-px w-full bg-ink-300" />
                <Text className="mt-2 text-xs text-ink-700">{data.school.signatory || "Principal"}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
