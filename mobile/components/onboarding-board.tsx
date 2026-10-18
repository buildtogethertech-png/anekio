import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiBase } from "../lib/api";
import { act } from "../lib/mutate";
import { downloadAuthedFile } from "../lib/print-html";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { pickFile, uploadFile, type PickedFile } from "../lib/upload";
import { Badge, Button, Card, Empty, Modal, PageHeader } from "./ui";
import { UploadCsvPanel } from "./upload-csv-panel";

type Onboarding = NonNullable<RecordPayload["onboarding"]>;
type Template = Onboarding["templates"][number];
type Preview = {
  batchId: string;
  kind: Template["kind"];
  rowCount: number;
  validCount: number;
  errors: string[];
  sample: Record<string, string>[];
  coveragePeriod?: string;
  dueDate?: string;
};
type GoogleSheetResult = {
  ok: true;
  connected: boolean;
  authUrl?: string;
  sheet?: {
    id: string;
    kind: Template["kind"];
    fileId: string;
    name: string;
    webViewLink: string;
  };
};

const SETUP_AREAS: { key: Onboarding["steps"][number]["area"]; title: string; body: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "school", title: "School basics", body: "Identity, sessions, classes, clock, and calendar.", icon: "school-outline" },
  { key: "teaching", title: "People", body: "Admission form, students, parents, staff, attendance, and people documents.", icon: "people-outline" },
  { key: "exams", title: "Exams", body: "Exam setup, marks history, and result documents.", icon: "reader-outline" },
  { key: "money", title: "Fees", body: "Opening dues, fee rules, invoice, receipt, and collections.", icon: "card-outline" },
];

const FOCUSED_IMPORT_COPY: Record<Template["kind"], { heading: string; description: string; requiredColumns: string; note: string }> = {
  students: {
    heading: "Choose a student CSV or Excel file",
    description: "Upload student and parent records for review.",
    requiredColumns: "Student name, date of birth, class, parent name, and parent mobile. Check the Field guide tab for any additional school-required fields.",
    note: "Imported students are not billed until the first-time fee import sets their billing start month. Download a fresh sheet after changing the admission form. Blank admission numbers and rolls are generated.",
  },
  teachers: {
    heading: "Choose a staff CSV or Excel file",
    description: "Upload teaching and office staff for review.",
    requiredColumns: "Name, Mobile, Role",
    note: "Employee IDs are generated when blank. Class teacher values can use labels like 1-A; review must pass before Apply changes records.",
  },
  class_teachers: {
    heading: "Choose a class-teacher CSV or Excel file",
    description: "Upload class ownership assignments for review.",
    requiredColumns: "Class, Class teacher employee ID or Teacher name",
    note: "Use class labels like 1-A. Review must pass before Apply updates class ownership.",
  },
  attendance: {
    heading: "Choose an attendance CSV or Excel file",
    description: "Upload old attendance for review.",
    requiredColumns: "Anekio student ID or Admission number, date columns",
    note: "Downloaded templates mark school days as P and holidays as H. Change absences to A; H and blank cells are skipped when Apply creates attendance.",
  },
  staff_attendance: {
    heading: "Choose a staff attendance CSV or Excel file",
    description: "Upload old staff attendance for review.",
    requiredColumns: "Anekio staff ID or Employee ID, Staff type, date columns",
    note: "Downloaded templates mark school days as P and holidays as H. Change absences to A; H and blank cells are skipped when Apply syncs staff attendance.",
  },
  exam_marks: {
    heading: "Choose an exam marks CSV or Excel file",
    description: "Upload old exam marks for review.",
    requiredColumns: "Anekio student ID or Admission number, generated exam columns",
    note: "Download the generated marks sheet, fill marks, use Ab for absent, and leave blanks to skip.",
  },
  opening_balances: {
    heading: "Choose a fee CSV or Excel file",
    description: "Upload first-time fee balances for review.",
    requiredColumns: "Admission number, Backlog invoice amount, Due date",
    note: "Include all unpaid fees through the current month and give each invoice its due date. Invoice date is created automatically; monthly billing starts the following month.",
  },
};

function statusTone(status: Onboarding["steps"][number]["status"]) {
  if (status === "complete") return "leaf" as const;
  if (status === "blocked") return "warn" as const;
  if (status === "optional") return "ink" as const;
  return "clay" as const;
}

function statusLabel(status: Onboarding["steps"][number]["status"]) {
  if (status === "complete") return "Complete";
  if (status === "blocked") return "Important";
  if (status === "optional") return "Not selected";
  return "Important";
}

export function OnboardingBoard({
  compact = false,
  focusKinds,
  onNavigate,
}: {
  compact?: boolean;
  focusKinds?: Template["kind"][];
  onNavigate?: () => void;
} = {}) {
  const router = useRouter();
  const { data, reload } = useRecord();
  const { token } = useSession();
  const onboarding = data?.onboarding;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingAck, setPendingAck] = useState("");
  const [stepImportKind, setStepImportKind] = useState<Template["kind"] | null>(null);
  const autoGoogleStarted = useRef(false);
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState<Record<string, boolean>>({});
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    // Web only: phones have a `window` object but no `window.location`; reading it crashes the app.
    if (autoGoogleStarted.current || !onboarding || !token || Platform.OS !== "web" || typeof window === "undefined" || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("googleSheets") !== "connected") return;
    const kind = params.get("googleKind") as Template["kind"] | null;
    const template = kind ? onboarding.templates.find((item) => item.kind === kind) : null;
    if (!template) return;
    autoGoogleStarted.current = true;
    void openGoogleSheet(template).finally(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("googleSheets");
      url.searchParams.delete("googleKind");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    });
  }, [onboarding, token]);

  if (!onboarding) return <Empty title="School setup is unavailable" body="Ask an administrator for the onboarding permission." />;
  const focused = Boolean(focusKinds?.length);
  const focusSet = new Set(focusKinds ?? []);
  const templates = focused ? onboarding.templates.filter((template) => focusSet.has(template.kind)) : onboarding.templates;
  const imports = focused ? onboarding.imports.filter((item) => focusSet.has(item.kind as Template["kind"])) : onboarding.imports;
  const focusedTemplate = focused && templates.length === 1 ? templates[0] : null;
  const focusedExamMarksCanBrowse = focusedTemplate?.kind === "exam_marks" && onboarding.counts.students > 0;
  const focusedBrowseDisabled = focusedTemplate ? (focusedExamMarksCanBrowse ? false : focusedTemplate.disabled) : false;
  const focusedNote = focusedTemplate
    ? focusedTemplate.disabled && !focusedExamMarksCanBrowse
      ? `Finish prerequisite first: ${focusedTemplate.prerequisite}.`
      : FOCUSED_IMPORT_COPY[focusedTemplate.kind].note
    : "";

  async function toggleStep(step: Onboarding["steps"][number], complete: boolean) {
    setBusy(`step:${step.key}`);
    setMessage("");
    try {
      await act(token, "toggleOnboardingStep", { key: step.key, complete });
      setPendingAck("");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the setup step.");
    } finally {
      setBusy("");
    }
  }

  async function openStepTarget(step: Onboarding["steps"][number]) {
    if (step.key === "students" && step.status === "blocked") {
      onNavigate?.();
      router.push("/school?tab=forms" as never);
      return;
    }
    if (step.key === "students" || step.key === "teachers" || step.key === "attendance" || step.key === "staff_attendance" || step.key === "exam_marks" || step.key === "opening_balances") {
      setBusy(`open:${step.key}`);
      setMessage("");
      try {
        await reload();
        setStepImportKind(step.key as Template["kind"]);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not refresh the setup step.");
      } finally {
        setBusy("");
      }
      return;
    }
    onNavigate?.();
    router.push((step.target?.href || "/school") as never);
  }

  async function download(template: Template, sampleData = false) {
    const busyKey = sampleData ? `downloadSample:${template.kind}` : `download:${template.kind}`;
    setBusy(busyKey);
    setMessage("");
    try {
      const suffix = sampleData ? "&sampleData=1" : "";
      await downloadAuthedFile(
        `${apiBase()}/api/v1/onboarding/template?kind=${encodeURIComponent(template.kind)}${suffix}`,
        token,
        sampleData ? `sample-${template.fileName}` : template.fileName
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download the template.");
    } finally {
      setBusy("");
    }
  }

  function onboardingReturnTo() {
    if (typeof window !== "undefined" && window.location?.origin) return `${window.location.origin}/onboarding`;
    return `${apiBase()}/onboarding`;
  }

  async function openGoogleSheet(template: Template) {
    const existing = onboarding?.googleSheets.find((row) => row.kind === template.kind);
    if (existing) {
      await Linking.openURL(existing.webViewLink);
      return;
    }
    setBusy(`google:${template.kind}`);
    setMessage("");
    try {
      const result = await act<GoogleSheetResult>(token, "createOnboardingGoogleSheet", {
        kind: template.kind,
        returnTo: onboardingReturnTo(),
      });
      if (result.authUrl) {
        await Linking.openURL(result.authUrl);
        setMessage("Approve Google Sheets access, then press Open in Google Sheets again.");
        return;
      }
      if (!result.sheet?.webViewLink) throw new Error("Google Sheet was not created.");
      await Linking.openURL(result.sheet.webViewLink);
      setMessage("Google Sheet created. Edit it there, then come back and press Review sheet.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open Google Sheets.");
    } finally {
      setBusy("");
    }
  }

  async function reviewGoogleSheet(template: Template) {
    if (!onboarding) return;
    const sheet = onboarding.googleSheets.find((row) => row.kind === template.kind);
    if (!sheet) {
      setMessage("Open this template in Google Sheets first.");
      return;
    }
    setBusy(`googleReview:${template.kind}`);
    setMessage("");
    setPreview(null);
    try {
      const result = await act<Preview & { ok: true; sheetId: string; webViewLink: string }>(token, "previewOnboardingGoogleSheet", {
        kind: template.kind,
        sheetId: sheet.id,
      });
      setMessage("");
      setPreview(result);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review the Google Sheet.");
    } finally {
      setBusy("");
    }
  }

  async function review(template: Template, dropped?: PickedFile) {
    setBusy(`upload:${template.kind}`);
    setMessage("");
    setPreview(null);
    try {
      const file = dropped ?? (await pickFile(".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
      if (!file) return;
      const uploaded = await uploadFile(token, file, { kind: "onboarding", onboardingKind: template.kind });
      const result = await act<Preview & { ok: true }>(token, "previewOnboardingImport", {
        kind: template.kind,
        uploadPath: uploaded.path,
        fileName: uploaded.fileName,
      });
      setMessage("");
      setPreview(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review the CSV file.");
    } finally {
      setBusy("");
    }
  }

  async function applyImport() {
    if (!preview) return;
    setBusy("apply");
    setMessage("");
    try {
      const result = await act<{ ok: true; created: number; updated: number }>(token, "applyOnboardingImport", {
        batchId: preview.batchId,
      });
      setMessage(`Applied successfully: ${result.created} created, ${result.updated} updated.`);
      setPreview(null);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply the import.");
    } finally {
      setBusy("");
    }
  }

  const importTitle = (kind: Template["kind"] | null) =>
    kind === "teachers"
      ? "Import staff"
      : kind === "opening_balances"
        ? "First time fee import"
        : kind === "attendance"
          ? "Import student attendance"
          : kind === "staff_attendance"
            ? "Import staff attendance"
            : kind === "exam_marks"
              ? "Import exam marks"
              : "Import students and parents";

  const phoneImportModal = (
    <RnModal visible={Boolean(stepImportKind)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setStepImportKind(null)}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <View className="flex-row items-center px-2 py-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => setStepImportKind(null)} className="flex-row items-center px-1 py-1">
            <Ionicons name="chevron-back" size={22} color="#1F45C7" />
            <Text className="text-[15px] font-medium text-[#1F45C7]">Setup</Text>
          </Pressable>
        </View>
        <Text className="px-4 pb-2 text-[22px] font-bold text-ink-900">{importTitle(stepImportKind)}</Text>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {stepImportKind ? <OnboardingBoard compact focusKinds={[stepImportKind]} /> : null}
        </ScrollView>
      </SafeAreaView>
    </RnModal>
  );

  if (phone && focusedTemplate) {
    const copy = FOCUSED_IMPORT_COPY[focusedTemplate.kind];
    const attendanceKind = focusedTemplate.kind === "attendance" || focusedTemplate.kind === "staff_attendance";
    const blocked = focusedBrowseDisabled;
    const stepDot = (n: number, done: boolean, active: boolean) => (
      <View className={`h-7 w-7 items-center justify-center rounded-full ${done ? "bg-[#1F45C7]" : active ? "border-2 border-[#1F45C7] bg-white" : "border border-ink-300 bg-white"}`}>
        {done ? <Ionicons name="checkmark" size={15} color="#fff" /> : <Text className={`text-xs font-bold ${active ? "text-[#1F45C7]" : "text-ink-500"}`}>{n}</Text>}
      </View>
    );
    return (
      <View className="gap-4">
        <View className="flex-row items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
          <Ionicons name="laptop-outline" size={16} color="#64748b" />
          <Text className="flex-1 text-xs text-ink-600">Easier on a computer: open Anekio on your laptop to fill the file.</Text>
        </View>
        {blocked ? (
          <View className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
            <Text className="text-sm text-amber-900">Finish this first: {focusedTemplate.prerequisite}.</Text>
          </View>
        ) : null}

        <View className="flex-row gap-3">
          {stepDot(1, Boolean(preview), !preview)}
          <View className="min-w-0 flex-1 gap-2">
            <Text className="text-[15px] font-semibold text-ink-900">Get the template</Text>
            <Text className="text-xs text-ink-500">Needs: {copy.requiredColumns}</Text>
            <View className="flex-row flex-wrap items-center gap-3">
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busy)}
                onPress={() => void download(focusedTemplate)}
                className="flex-row items-center gap-1.5 rounded-xl border border-[#1F45C7] px-3.5 py-2.5"
              >
                <Ionicons name="download-outline" size={16} color="#1F45C7" />
                <Text className="text-sm font-semibold text-[#1F45C7]">{busy === `download:${focusedTemplate.kind}` ? "Preparing…" : "Download template"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void download(focusedTemplate, true)} hitSlop={6}>
                <Text className="text-sm font-medium text-ink-600">{busy === `downloadSample:${focusedTemplate.kind}` ? "Preparing…" : "Sample data"}</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setHowOpen((v) => !v)} className="flex-row items-center gap-1 self-start">
              <Text className="text-xs font-semibold text-[#1F45C7]">How to fill the file</Text>
              <Ionicons name={howOpen ? "chevron-up" : "chevron-down"} size={13} color="#1F45C7" />
            </Pressable>
            {howOpen ? (
              <View className="gap-2 rounded-xl bg-ink-50 p-3">
                {attendanceKind ? (
                  <View className="gap-1.5">
                    {(
                      [
                        ["P", "Present", "bg-green-100 text-green-800"],
                        ["A", "Absent — change P to A", "bg-red-100 text-red-700"],
                        ["H", "Holiday — skipped", "bg-sky-100 text-sky-700"],
                        ["", "Blank — skipped", "bg-white text-ink-400"],
                      ] as const
                    ).map(([code, text, tone]) => (
                      <View key={text} className="flex-row items-center gap-2">
                        <Text className={`w-7 rounded-md py-0.5 text-center text-xs font-bold ${tone}`}>{code || "–"}</Text>
                        <Text className="text-xs text-ink-700">{text}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text className="text-xs leading-5 text-ink-700">{copy.note}</Text>
                )}
              </View>
            ) : null}
          </View>
        </View>

        <View className="flex-row gap-3">
          {stepDot(2, Boolean(preview), !preview)}
          <View className="min-w-0 flex-1 gap-2">
            <Text className="text-[15px] font-semibold text-ink-900">Upload the filled file</Text>
            <Pressable
              accessibilityRole="button"
              disabled={blocked || Boolean(busy)}
              onPress={() => void review(focusedTemplate)}
              className={`flex-row items-center gap-3 rounded-xl px-3 py-3 ${preview ? "border border-emerald-300 bg-emerald-50" : "border-2 border-dashed border-ink-200 bg-white"} ${blocked ? "opacity-50" : ""}`}
            >
              <View className={`h-10 w-10 items-center justify-center rounded-lg ${preview ? "bg-white" : "bg-[#EEF3FF]"}`}>
                {busy === `upload:${focusedTemplate.kind}` ? (
                  <ActivityIndicator size="small" color="#1F45C7" />
                ) : (
                  <Ionicons name={preview ? "document-text" : "cloud-upload-outline"} size={20} color={preview ? "#047857" : "#1F45C7"} />
                )}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-ink-900">
                  {busy === `upload:${focusedTemplate.kind}` ? "Reading file…" : preview ? `${preview.rowCount} rows read` : "Choose CSV or Excel"}
                </Text>
                <Text className="text-xs text-ink-500">{preview ? "Tap to choose another file" : ".csv or .xlsx"}</Text>
              </View>
              {preview ? <Text className="text-sm font-semibold text-[#1F45C7]">Change</Text> : null}
            </Pressable>
          </View>
        </View>

        <View className="flex-row gap-3">
          {stepDot(3, false, Boolean(preview))}
          <View className="min-w-0 flex-1 gap-2">
            <Text className={`text-[15px] font-semibold ${preview ? "text-ink-900" : "text-ink-400"}`}>Review & apply</Text>
            {!preview ? <Text className="text-xs text-ink-400">Rows are checked before anything is saved.</Text> : null}
            {preview ? (
              <View className={`gap-2 rounded-xl border p-3 ${preview.errors.length ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                <Text className="text-sm font-semibold text-ink-900">
                  {preview.validCount} of {preview.rowCount} rows ready
                  {preview.errors.length ? ` · ${preview.errors.length} issues` : ""}
                </Text>
                {preview.errors.slice(0, 8).map((error) => (
                  <Text key={error} className="text-xs leading-5 text-red-700">
                    • {error}
                  </Text>
                ))}
                {preview.errors.length > 8 ? <Text className="text-xs text-red-700">And {preview.errors.length - 8} more.</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={preview.errors.length > 0 || busy === "apply"}
                  onPress={() => void applyImport()}
                  className={`mt-1 h-11 items-center justify-center rounded-xl ${preview.errors.length ? "bg-ink-200" : "bg-[#1F45C7]"}`}
                >
                  <Text className="text-sm font-semibold text-white">
                    {busy === "apply" ? "Applying…" : preview.errors.length ? "Fix the file and upload again" : `Apply ${preview.rowCount} rows`}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {message ? (
          <View className={`rounded-xl px-3 py-2.5 ${message.startsWith("Applied") ? "bg-emerald-50" : "bg-amber-50"}`}>
            <Text className="text-sm text-ink-800">{message}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (phone && !focused) {
    const steps = onboarding.steps;
    const done = steps.filter((st) => st.status === "complete").length;
    const upNext =
      steps.find((st) => st.status === "ready") || steps.find((st) => st.status === "blocked") || steps.find((st) => st.status !== "complete");
    const activeArea = openArea ?? upNext?.area ?? "school";
    const pct = onboarding.progress.percent;

    const stepRow = (step: Onboarding["steps"][number], i: number) => {
      const loading = busy === `step:${step.key}` || busy === `open:${step.key}`;
      const complete = step.status === "complete";
      const blockedStep = step.status === "blocked";
      const showingAck = pendingAck === step.key;
      const canSkip = !complete && step.manualAllowed !== false && !step.dataComplete;
      return (
        <View key={step.key} className={i ? "border-t border-ink-100" : ""}>
          <Pressable accessibilityRole="button" onPress={() => void openStepTarget(step)} className="flex-row items-start gap-3 px-3 py-3 active:bg-slate-50">
            <View
              className={`mt-0.5 h-7 w-7 items-center justify-center rounded-full ${
                complete ? "bg-emerald-500" : blockedStep ? "bg-ink-100" : "border-2 border-[#1F45C7] bg-white"
              }`}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#1F45C7" />
              ) : complete ? (
                <Ionicons name="checkmark" size={15} color="#fff" />
              ) : blockedStep ? (
                <Ionicons name="lock-closed" size={12} color="#94a3b8" />
              ) : (
                <Text className="text-xs font-bold text-[#1F45C7]">{step.number}</Text>
              )}
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text className={`min-w-0 flex-1 text-[15px] font-semibold ${complete ? "text-ink-500" : "text-ink-900"}`} numberOfLines={2}>
                  {step.title}
                </Text>
                {step.status === "optional" ? (
                  <Text className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">Optional</Text>
                ) : null}
              </View>
              <Text className="mt-0.5 text-xs leading-4 text-ink-500" numberOfLines={2}>
                {blockedStep && step.missingReason ? step.missingReason : step.body}
              </Text>
              {step.manualComplete && !step.dataComplete ? (
                <Pressable hitSlop={6} onPress={() => void toggleStep(step, false)} className="mt-1 self-start">
                  <Text className="text-[11px] font-medium text-amber-700">Skipped for now · Undo</Text>
                </Pressable>
              ) : canSkip && !showingAck ? (
                <Pressable hitSlop={6} onPress={() => setPendingAck(step.key)} className="mt-1 self-start">
                  <Text className="text-[11px] font-medium text-ink-400">Skip for now</Text>
                </Pressable>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#cbd5e1" style={{ marginTop: 6 }} />
          </Pressable>
          {showingAck ? (
            <View className="mx-3 mb-3 gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <Text className="text-xs leading-5 text-amber-900">{step.missingReason || "Later school workflows use this data."}</Text>
              <View className="flex-row gap-4">
                <Pressable hitSlop={6} disabled={loading} onPress={() => void toggleStep(step, true)}>
                  <Text className="text-xs font-semibold text-amber-900">Skip anyway</Text>
                </Pressable>
                <Pressable hitSlop={6} onPress={() => setPendingAck("")}>
                  <Text className="text-xs font-medium text-ink-600">Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      );
    };

    return (
      <View className="gap-4 pb-6">
        <View className="flex-row items-center gap-4 rounded-2xl bg-white p-4">
          <View className="h-16 w-16 items-center justify-center rounded-full border-[6px] border-[#EEF3FF]">
            <View
              className="absolute inset-[-6px] rounded-full border-[6px] border-transparent"
              style={{
                borderTopColor: pct > 0 ? "#1F45C7" : "transparent",
                borderRightColor: pct >= 25 ? "#1F45C7" : "transparent",
                borderBottomColor: pct >= 50 ? "#1F45C7" : "transparent",
                borderLeftColor: pct >= 75 ? "#1F45C7" : "transparent",
                transform: [{ rotate: "45deg" }],
              }}
            />
            <Text className="text-sm font-bold text-ink-900">{pct}%</Text>
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-lg font-bold text-ink-900">
              {done} of {steps.length} done
            </Text>
            <Text className="text-xs text-ink-500">{steps.length - done} steps left to launch the school</Text>
          </View>
        </View>

        {upNext ? (
          <View className="rounded-2xl bg-[#1F45C7] p-4">
            <Text className="text-xs font-semibold uppercase tracking-wide text-white/70">Up next</Text>
            <Text className="mt-1 text-lg font-bold text-white">{upNext.title}</Text>
            <Text className="mt-0.5 text-sm text-white/85" numberOfLines={2}>
              {upNext.status === "blocked" && upNext.missingReason ? upNext.missingReason : upNext.body}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openStepTarget(upNext)}
              className="mt-3 h-11 flex-row items-center justify-center gap-1.5 self-start rounded-xl bg-white px-5"
            >
              <Text className="text-sm font-semibold text-[#1F45C7]">{busy === `open:${upNext.key}` ? "Opening…" : "Start"}</Text>
              <Ionicons name="arrow-forward" size={15} color="#1F45C7" />
            </Pressable>
          </View>
        ) : null}

        {SETUP_AREAS.map((area) => {
          const areaSteps = steps.filter((st) => st.area === area.key);
          if (!areaSteps.length) return null;
          const areaDone = areaSteps.filter((st) => st.status === "complete");
          const pending = areaSteps.filter((st) => st.status !== "complete");
          const isOpen = activeArea === area.key;
          return (
            <View key={area.key} className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpenArea(isOpen ? "" : area.key)}
                className="flex-row items-center gap-3 px-3 py-3"
              >
                <View className="h-9 w-9 items-center justify-center rounded-lg bg-[#EEF3FF]">
                  <Ionicons name={area.icon} size={18} color="#1F45C7" />
                </View>
                <Text className="flex-1 text-[15px] font-semibold text-ink-900">{area.title}</Text>
                <Text className={`text-sm font-semibold ${areaDone.length === areaSteps.length ? "text-emerald-600" : "text-ink-500"}`}>
                  {areaDone.length}/{areaSteps.length}
                </Text>
                <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color="#64748b" />
              </Pressable>
              {isOpen ? (
                <View className="border-t border-ink-100">
                  {pending.map(stepRow)}
                  {!pending.length ? <Text className="px-3 py-3 text-sm text-emerald-700">All done here.</Text> : null}
                  {areaDone.length ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setDoneOpen((cur) => ({ ...cur, [area.key]: !cur[area.key] }))}
                        className="flex-row items-center gap-1 border-t border-ink-100 px-3 py-2.5"
                      >
                        <Text className="text-xs font-semibold text-ink-500">Done ({areaDone.length})</Text>
                        <Ionicons name={doneOpen[area.key] ? "chevron-up" : "chevron-down"} size={13} color="#64748b" />
                      </Pressable>
                      {doneOpen[area.key] ? areaDone.map((st, i) => stepRow(st, i + 1)) : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {message ? (
          <View className="rounded-xl bg-amber-50 px-3 py-2.5">
            <Text className="text-sm text-ink-800">{message}</Text>
          </View>
        ) : null}
        {phoneImportModal}
      </View>
    );
  }

  return (
    <View className={`mx-auto w-full gap-4 pb-10 ${compact ? "max-w-none" : "max-w-6xl"}`}>
      {compact ? null : (
        <PageHeader
          kicker="School launch"
          title="Set up this school"
          lede="Choose only what this school needs. Anekio generates the next CSV from data already imported, so the onboarding team never rebuilds the same file twice."
        />
      )}

      {focused ? null : (
        <>
          <Card className="gap-4 p-5">
            <View className="flex-row items-center justify-between gap-4">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold text-ink-900">School setup</Text>
                <Text className="mt-1 text-xs leading-5 text-ink-700">Work through School basics, People, Exams, and Fees. Steps validate live setup data before they can be checked directly.</Text>
              </View>
              <Badge tone="clay">{`${onboarding.progress.percent}% complete`}</Badge>
            </View>
            <View className="h-2 overflow-hidden rounded-full bg-ink-100">
              <View className="h-2 rounded-full bg-clay-500" style={{ width: `${onboarding.progress.percent}%` }} />
            </View>
          </Card>

          <View className="gap-2">
            {SETUP_AREAS.map((area) => {
              const steps = onboarding.steps.filter((step) => step.area === area.key);
              const complete = steps.filter((step) => step.status === "complete").length;
              return (
                <Card key={area.key} className="gap-3 p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1 flex-row items-start gap-3">
                      <View className="h-9 w-9 items-center justify-center rounded-lg bg-clay-50">
                        <Ionicons name={area.icon} size={20} color="#2563eb" />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-semibold text-ink-900">{area.title}</Text>
                        <Text className="mt-0.5 text-xs leading-5 text-ink-700">{area.body}</Text>
                      </View>
                    </View>
                    <Badge tone={complete === steps.length ? "leaf" : "clay"}>{`${complete}/${steps.length}`}</Badge>
                  </View>
                  <View className="gap-2">
                    {steps.map((step) => {
                      const canCheckDirectly = step.dataComplete || step.manualComplete;
                      const canContinueManually = step.manualAllowed !== false;
                      const showingAck = pendingAck === step.key;
                      const loading = busy === `step:${step.key}` || busy === `open:${step.key}`;
                      return (
                        <View key={step.key} className="rounded-lg border border-ink-100 bg-white p-3">
                          <View className="flex-row items-start gap-3">
                            <Pressable
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: step.status === "complete" }}
                              accessibilityLabel={`${step.title} setup step`}
                              disabled={loading}
                              onPress={() => {
                                if (step.manualComplete) void toggleStep(step, false);
                                else if (step.dataComplete) void toggleStep(step, true);
                                else if (canContinueManually) setPendingAck(showingAck ? "" : step.key);
                                else void openStepTarget(step);
                              }}
                              className={`h-7 w-7 items-center justify-center rounded-md border ${step.status === "complete" ? "border-emerald-600 bg-emerald-100" : step.status === "blocked" ? "border-amber-500 bg-white" : "border-ink-300 bg-white"}`}
                            >
                              {loading ? (
                                <ActivityIndicator color="#2563eb" size="small" />
                              ) : step.status === "complete" ? (
                                <Ionicons name="checkmark" size={17} color="#047857" />
                              ) : (
                                <Text className={`text-xs font-semibold ${step.status === "blocked" ? "text-amber-800" : "text-clay-700"}`}>{step.number}</Text>
                              )}
                            </Pressable>
                            <View className="min-w-0 flex-1">
                              <View className="flex-row items-center justify-between gap-2">
                                <Pressable
                                  accessibilityRole="link"
                                  accessibilityLabel={`${step.title} setup`}
                                  onPress={() => void openStepTarget(step)}
                                  className="min-w-0 flex-1 flex-row items-center gap-1"
                                >
                                  <Text className="min-w-0 text-sm font-semibold text-clay-700 underline" numberOfLines={1}>{step.title}</Text>
                                  <Ionicons name="arrow-forward" size={13} color="#1d4ed8" />
                                </Pressable>
                                <Badge tone={statusTone(step.status)}>{step.manualComplete && !step.dataComplete ? "Continued" : statusLabel(step.status)}</Badge>
                              </View>
                              <Text className="mt-1 text-xs leading-5 text-ink-700">{step.body}</Text>
                              {step.manualComplete && !step.dataComplete ? (
                                <Text className="mt-1 text-[11px] leading-4 text-amber-800">Marked continue anyway. Add the missing setup later when the school is ready.</Text>
                              ) : null}
                            </View>
                          </View>
                          {showingAck && !canCheckDirectly && canContinueManually ? (
                            <View className="mt-3 gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                              <Text className="text-xs font-semibold text-amber-950">This setup is important</Text>
                              <Text className="text-xs leading-5 text-amber-900">{step.missingReason || "This data is needed by later school workflows."}</Text>
                              <Pressable
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: false }}
                                disabled={loading}
                                onPress={() => void toggleStep(step, true)}
                                className="flex-row items-center gap-2"
                              >
                                <View className="h-5 w-5 items-center justify-center rounded border border-amber-500 bg-white" />
                                <Text className="text-xs font-semibold text-amber-950">Continue anyway</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      {focusedTemplate ? (
        <View className="gap-2">
          <UploadCsvPanel
            heading={FOCUSED_IMPORT_COPY[focusedTemplate.kind].heading}
            description={FOCUSED_IMPORT_COPY[focusedTemplate.kind].description}
            requiredColumns={FOCUSED_IMPORT_COPY[focusedTemplate.kind].requiredColumns}
            note={focusedNote}
            supportedFormat=".csv, .xlsx"
            browseLabel={busy === `upload:${focusedTemplate.kind}` ? "Reviewing..." : "Browse"}
            templateLabel={busy === `download:${focusedTemplate.kind}` ? "Preparing..." : "Download template"}
            sampleLabel={busy === `downloadSample:${focusedTemplate.kind}` ? "Preparing..." : "Download test data"}
            browseDisabled={focusedBrowseDisabled || Boolean(busy)}
            downloadDisabled={Boolean(busy)}
            onBrowse={() => void review(focusedTemplate)}
            onDropFile={(file) => void review(focusedTemplate, file)}
            onDownloadTemplate={() => void download(focusedTemplate)}
            onDownloadSample={() => void download(focusedTemplate, true)}
          />
        </View>
      ) : null}

      {preview ? (
        <Card className={`gap-3 p-5 ${preview.errors.length ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
          <View className="flex-row items-center justify-between gap-3">
            <View>
              <Text className="text-base font-semibold text-ink-900">Import review</Text>
              <Text className="mt-1 text-xs text-ink-700">{preview.validCount} of {preview.rowCount} rows are ready.</Text>
            </View>
            <Badge tone={preview.errors.length ? "danger" : "leaf"}>{preview.errors.length ? `${preview.errors.length} issues` : "Ready to apply"}</Badge>
          </View>
          {preview.kind === "opening_balances" && preview.coveragePeriod ? (
            <View className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
              <Text className="text-sm font-medium text-ink-900">Opening amounts cover all unpaid fees through {preview.coveragePeriod}.</Text>
              <Text className="mt-1 text-xs text-ink-700">Each invoice uses the Due date in its row. Invoice date is created automatically. Monthly invoices begin {new Date(Number(preview.coveragePeriod.slice(0, 4)), Number(preview.coveragePeriod.slice(5, 7)), 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}.</Text>
            </View>
          ) : null}
          {preview.errors.slice(0, 12).map((error) => <Text key={error} className="text-xs leading-5 text-red-700">• {error}</Text>)}
          {preview.errors.length > 12 ? <Text className="text-xs text-red-700">And {preview.errors.length - 12} more issues.</Text> : null}
          {message ? (
            <View className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <Text className="text-xs leading-5 text-amber-900">{message}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setPreview(null)}>Cancel</Button>
            <Button disabled={preview.errors.length > 0 || busy === "apply"} onPress={() => void applyImport()}>
              {busy === "apply" ? "Applying…" : `Apply ${preview.rowCount} rows`}
            </Button>
          </View>
        </Card>
      ) : null}

      {message && !preview ? (
        <Card className={`p-4 ${message.startsWith("Applied") ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <Text className="text-sm text-ink-800">{message}</Text>
        </Card>
      ) : null}

      {phone ? phoneImportModal : null}
      <Modal
        open={!phone && Boolean(stepImportKind)}
        title={
          stepImportKind === "teachers"
            ? "Import staff"
            : stepImportKind === "opening_balances"
              ? "First time fee import"
            : stepImportKind === "attendance"
              ? "Import student attendance history"
              : stepImportKind === "staff_attendance"
                ? "Import staff attendance history"
                : stepImportKind === "exam_marks"
                  ? "Import exam marks history"
                : "Import students and parents"
        }
        onClose={() => setStepImportKind(null)}
        wide
      >
        {stepImportKind ? <OnboardingBoard compact focusKinds={[stepImportKind]} /> : null}
      </Modal>

      {!compact && imports.length ? (
        <Card className="gap-3 p-5">
          <Text className="text-base font-semibold text-ink-900">Recent imports</Text>
          {imports.map((item) => (
            <View key={item.id} className="flex-row items-center justify-between gap-3 border-t border-ink-100 pt-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{item.fileName}</Text>
                <Text className="mt-0.5 text-[11px] text-ink-500">{item.kind.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString("en-IN")}</Text>
              </View>
              <Badge tone={item.status === "APPLIED" ? "leaf" : item.status === "FAILED" ? "danger" : "warn"}>{item.status}</Badge>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
