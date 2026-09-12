import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { apiBase } from "../lib/api";
import { act } from "../lib/mutate";
import { downloadAuthedFile } from "../lib/print-html";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { pickFile, uploadFile } from "../lib/upload";
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
  { key: "school", title: "School", body: "Identity, sessions, classes, and day structure.", icon: "school-outline" },
  { key: "teaching", title: "Teaching", body: "Students, parents, staff, attendance, and people documents.", icon: "people-outline" },
  { key: "exams", title: "Exams", body: "Exam setup, marks history, and result documents.", icon: "reader-outline" },
  { key: "money", title: "Money", body: "Opening dues, fee rules, invoice, receipt, and collections.", icon: "card-outline" },
];

const FOCUSED_IMPORT_COPY: Record<Template["kind"], { heading: string; description: string; requiredColumns: string; note: string }> = {
  students: {
    heading: "Choose a student CSV or Excel file",
    description: "Upload student and parent records for review.",
    requiredColumns: "Student name, Date of birth, Class, Parent name, Parent mobile or Parent email",
    note: "Blank admission numbers are generated. Parent logins are matched or created from parent email/mobile; review must pass before Apply changes records.",
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
    requiredColumns: "Admission number, Backlog invoice amount, Due date, Invoices already generated till",
    note: "Opening balances create backlog invoices only after review passes and you press Apply.",
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

  useEffect(() => {
    if (autoGoogleStarted.current || !onboarding || !token || typeof window === "undefined") return;
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

  function openStepTarget(step: Onboarding["steps"][number]) {
    if (step.key === "students" || step.key === "teachers" || step.key === "attendance" || step.key === "staff_attendance" || step.key === "exam_marks" || step.key === "opening_balances") {
      setStepImportKind(step.key as Template["kind"]);
      void reload();
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

  async function review(template: Template) {
    setBusy(`upload:${template.kind}`);
    setMessage("");
    setPreview(null);
    try {
      const file = await pickFile(".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
                <Text className="mt-1 text-xs leading-5 text-ink-700">Work through School, Teaching, Exams, and Money. Steps validate live setup data before they can be checked directly.</Text>
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
                      const loading = busy === `step:${step.key}`;
                      return (
                        <View key={step.key} className={`rounded-lg border p-3 ${step.status === "blocked" ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-white"}`}>
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
                                else openStepTarget(step);
                              }}
                              className={`h-7 w-7 items-center justify-center rounded-md border ${step.status === "complete" ? "border-emerald-600 bg-emerald-100" : "border-ink-300 bg-white"}`}
                            >
                              {loading ? (
                                <ActivityIndicator color="#2563eb" size="small" />
                              ) : step.status === "complete" ? (
                                <Ionicons name="checkmark" size={17} color="#047857" />
                              ) : (
                                <Text className="text-xs font-semibold text-clay-700">{step.number}</Text>
                              )}
                            </Pressable>
                            <View className="min-w-0 flex-1">
                              <View className="flex-row items-center justify-between gap-2">
                                <Pressable
                                  accessibilityRole="link"
                                  accessibilityLabel={`${step.title} setup`}
                                  onPress={() => openStepTarget(step)}
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
            note={focusedTemplate.disabled ? `Finish prerequisite first: ${focusedTemplate.prerequisite}.` : FOCUSED_IMPORT_COPY[focusedTemplate.kind].note}
            supportedFormat=".csv, .xlsx"
            browseLabel={busy === `upload:${focusedTemplate.kind}` ? "Reviewing..." : "Browse"}
            templateLabel={busy === `download:${focusedTemplate.kind}` ? "Preparing..." : "Download template"}
            sampleLabel={busy === `downloadSample:${focusedTemplate.kind}` ? "Preparing..." : "Download test data"}
            browseDisabled={focusedTemplate.disabled || Boolean(busy)}
            downloadDisabled={Boolean(busy)}
            onBrowse={() => void review(focusedTemplate)}
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

      <Modal
        open={Boolean(stepImportKind)}
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

      {imports.length ? (
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
