import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { AdmissionFormField, RecordPayload } from "../lib/record";
import { act } from "../lib/mutate";
import { useAssetUrl } from "../lib/assets";
import { pickFile, uploadFile, type PickedFile } from "../lib/upload";

/**
 * Phone tool for filling student details fast ("Fill a field"):
 * - a detail (blood group, category, …): a row per student for a whole class, saved on each tap;
 * - a photo or document (student photo, Aadhaar card, …): students one after another — take the photo or scan the
 *   document, it saves, the next one comes up.
 */
type Student = NonNullable<RecordPayload["people"]>[number];
type ClassRow = { id: string; label: string };

const BLUE = "#1F45C7";

function fillable(form: AdmissionFormField[]) {
  return form.filter((f) => !f.builtin && f.type !== "file" && ["select", "radio", "text", "textarea", "number", "phone", "email"].includes(f.type));
}

function uploadable(form: AdmissionFormField[]) {
  return form.filter((f) => !f.builtin && f.type === "file").sort((a, b) => Number(b.id === "studentPhoto") - Number(a.id === "studentPhoto"));
}

function byClassThenRoll(a: Student, b: Student) {
  return (a.classLabel || "").localeCompare(b.classLabel || "", undefined, { numeric: true }) || (Number(a.rollNumber) || 999) - (Number(b.rollNumber) || 999) || a.name.localeCompare(b.name);
}

function ScreenHeader({ title, subtitle, onBack, backLabel }: { title: string; subtitle?: string; onBack: () => void; backLabel: string }) {
  return (
    <View className="flex-row items-center gap-1 border-b border-ink-100 px-2 py-2">
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={8} onPress={onBack} className="h-10 w-10 items-center justify-center rounded-full">
        <Ionicons name="chevron-back" size={22} color={BLUE} />
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[17px] font-semibold text-ink-900">{title}</Text>
        {subtitle ? <Text numberOfLines={1} className="text-[12px] text-ink-500">{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function ClassChips({ classes, value, onChange, counts }: { classes: ClassRow[]; value: string; onChange: (id: string) => void; counts?: Map<string, number> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerClassName="gap-1.5 px-4 py-2.5">
      {[{ id: "", label: "All classes" }, ...classes].map((c) => {
        const on = value === c.id;
        const n = counts?.get(c.id);
        return (
          <Pressable
            key={c.id || "all"}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(c.id)}
            className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
          >
            <Text className={`text-[13px] font-semibold ${on ? "text-white" : "text-ink-700"}`}>{c.label}</Text>
            {n !== undefined ? <Text className={`text-[12px] ${on ? "text-white/80" : "text-ink-400"}`}>{n}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Fill a field                                                         */
/* ------------------------------------------------------------------ */

export function FillFieldScreen({
  open,
  students,
  classes,
  form,
  token,
  onClose,
}: {
  open: boolean;
  students: Student[];
  classes: ClassRow[];
  form: AdmissionFormField[];
  token: string | null;
  /** Called with true when something was saved (reload the list then). */
  onClose: (changed: boolean) => void;
}) {
  const fields = useMemo(() => fillable(form), [form]);
  const files = useMemo(() => uploadable(form), [form]);
  const [fieldId, setFieldId] = useState("");
  const [fileId, setFileId] = useState("");
  const [classId, setClassId] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  // Values saved here, so rows show them at once and don't jump out of "only empty" while filling.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const inputs = useRef(new Map<string, TextInput | null>());

  useEffect(() => {
    if (!open) return;
    setFieldId("");
    setFileId("");
    setSaved({});
    setKept(new Set());
    setDrafts({});
    setError("");
  }, [open]);

  const field = fields.find((f) => f.id === fieldId);
  const fileField = files.find((f) => f.id === fileId);
  const valueOf = (s: Student) => saved[`${s.id}:${fieldId}`] ?? s.admissionData?.[fieldId] ?? "";
  const filledCount = (f: AdmissionFormField) => students.filter((s) => (saved[`${s.id}:${f.id}`] ?? s.admissionData?.[f.id] ?? "").trim()).length;
  const rows = useMemo(
    () =>
      students
        .filter((s) => !classId || s.classId === classId)
        .filter((s) => !onlyEmpty || kept.has(s.id) || !(s.admissionData?.[fieldId] || "").trim())
        .sort(byClassThenRoll),
    [students, classId, onlyEmpty, kept, fieldId]
  );
  const inClass = students.filter((s) => !classId || s.classId === classId);
  const doneInClass = inClass.filter((s) => valueOf(s).trim()).length;

  async function save(s: Student, value: string) {
    if (!field) return;
    const key = `${s.id}:${field.id}`;
    setBusy(key);
    setError("");
    setKept((k) => new Set(k).add(s.id));
    const before = saved[key];
    setSaved((m) => ({ ...m, [key]: value }));
    try {
      const res = await act<{ results?: { ok: boolean; error?: string }[] }>(token, "bulkUpdateStudents", {
        rows: [{ studentId: s.id, fields: { custom: { [field.id]: value } } }],
      });
      const bad = res?.results?.find((r) => !r.ok);
      if (bad) throw new Error(bad.error || "Could not save.");
    } catch (e) {
      setSaved((m) => {
        const next = { ...m };
        if (before === undefined) delete next[key];
        else next[key] = before;
        return next;
      });
      setError(`${s.name}: ${e instanceof Error ? e.message : "Could not save."}`);
    } finally {
      setBusy("");
    }
  }

  const changed = Object.keys(saved).length > 0;
  const close = () => onClose(changed);

  return (
    <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => (fileField ? setFileId("") : field ? setFieldId("") : close())}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        {fileField ? (
          <UploadFlow
            students={students}
            classes={classes}
            field={fileField}
            token={token}
            saved={saved}
            onSaved={(sid, path) => setSaved((m) => ({ ...m, [`${sid}:${fileField.id}`]: path }))}
            onBack={() => setFileId("")}
          />
        ) : !field ? (
          <>
            <ScreenHeader title="Fill a field" subtitle="Pick what to fill for your students" onBack={close} backLabel="Close" />
            <ScrollView contentContainerClassName="gap-2 p-4">
              {files.length ? <Text className="px-1 pb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-500">Photos & documents</Text> : null}
              {files.map((f) => {
                const n = filledCount(f);
                const pct = students.length ? n / students.length : 0;
                const photo = f.fileType === "image";
                return (
                  <Pressable key={f.id} accessibilityRole="button" onPress={() => setFileId(f.id)} className="rounded-2xl border border-ink-100 bg-white p-4 active:bg-ink-50">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#1F45C7]">
                        <Ionicons name={photo ? "camera-outline" : "document-attach-outline"} size={18} color="#fff" />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold text-ink-900">{f.label}</Text>
                        <Text className="text-[12px] text-ink-500">{`${n} of ${students.length} uploaded · ${photo ? "take photos" : "scan or upload"}`}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                    </View>
                    <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <View className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(pct * 100)}%` }} />
                    </View>
                  </Pressable>
                );
              })}
              {files.length && fields.length ? <Text className="px-1 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-ink-500">Details</Text> : null}
              {fields.length || files.length ? (
                fields.map((f) => {
                  const n = filledCount(f);
                  const pct = students.length ? n / students.length : 0;
                  return (
                    <Pressable
                      key={f.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setFieldId(f.id);
                        setKept(new Set());
                        setDrafts({});
                      }}
                      className="rounded-2xl border border-ink-100 bg-white p-4 active:bg-ink-50"
                    >
                      <View className="flex-row items-center gap-3">
                        <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
                          <Ionicons name={f.type === "select" || f.type === "radio" ? "options-outline" : "create-outline"} size={18} color={BLUE} />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-[15px] font-semibold text-ink-900">{f.label}</Text>
                          <Text className="text-[12px] text-ink-500">{`${n} of ${students.length} filled`}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                      </View>
                      <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <View className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(pct * 100)}%` }} />
                      </View>
                    </Pressable>
                  );
                })
              ) : (
                <Text className="p-6 text-center text-[14px] text-ink-500">The admission form has no fields to fill. Add some in School setup → Forms.</Text>
              )}
            </ScrollView>
          </>
        ) : (
          <>
            <ScreenHeader title={field.label} subtitle={`${doneInClass} of ${inClass.length} filled${classId ? ` in ${classes.find((c) => c.id === classId)?.label}` : ""}`} onBack={() => setFieldId("")} backLabel="Back to fields" />
            <View className="h-1 bg-ink-100">
              <View className="h-full bg-emerald-500" style={{ width: `${inClass.length ? Math.round((doneInClass / inClass.length) * 100) : 0}%` }} />
            </View>
            <ClassChips classes={classes} value={classId} onChange={setClassId} />
            <View className="flex-row items-center justify-between px-4 pb-2">
              <Text className="text-[12px] text-ink-500">{`${rows.length} student${rows.length === 1 ? "" : "s"}`}</Text>
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: onlyEmpty }} onPress={() => setOnlyEmpty((v) => !v)} className="flex-row items-center gap-1.5">
                <Ionicons name={onlyEmpty ? "checkbox" : "square-outline"} size={18} color={onlyEmpty ? BLUE : "#94A3B8"} />
                <Text className="text-[13px] text-ink-700">Only empty</Text>
              </Pressable>
            </View>
            {error ? (
              <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
                <Ionicons name="alert-circle" size={14} color="#B91C1C" />
                <Text className="min-w-0 flex-1 text-[12px] text-red-800">{error}</Text>
              </View>
            ) : null}
            <FlatList
              data={rows}
              keyExtractor={(s) => s.id}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="pb-10"
              ListEmptyComponent={
                <View className="items-center p-10">
                  <Ionicons name="checkmark-circle" size={40} color="#10B981" />
                  <Text className="mt-2 text-[15px] font-semibold text-ink-900">All filled</Text>
                  <Text className="mt-1 text-center text-[13px] text-ink-500">Every student here has {field.label.toLowerCase()}.</Text>
                </View>
              }
              renderItem={({ item: s, index }) => {
                const key = `${s.id}:${field.id}`;
                const value = valueOf(s);
                const choice = field.type === "select" || field.type === "radio";
                return (
                  <View className="border-b border-ink-100 px-4 py-3">
                    <View className="flex-row items-center gap-2">
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-[15px] font-medium text-ink-900">{s.name}</Text>
                        <Text className="text-[12px] text-ink-500">{[s.classLabel, Number(s.rollNumber) > 0 ? `Roll ${s.rollNumber}` : "", s.admissionNo].filter(Boolean).join(" · ")}</Text>
                      </View>
                      {busy === key ? <ActivityIndicator size="small" color={BLUE} /> : value && saved[key] !== undefined ? <Ionicons name="checkmark-circle" size={18} color="#10B981" /> : null}
                    </View>
                    {choice ? (
                      <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {(field.options || []).map((o) => {
                          const on = value === o;
                          return (
                            <Pressable
                              key={o}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: on }}
                              disabled={busy === key}
                              onPress={() => void save(s, on ? "" : o)}
                              className={`h-10 justify-center rounded-xl border px-4 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white active:bg-ink-50"}`}
                            >
                              <Text className={`text-[14px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{o}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <TextInput
                        ref={(r) => {
                          inputs.current.set(s.id, r);
                        }}
                        value={drafts[s.id] ?? value}
                        onChangeText={(t) => setDrafts((d) => ({ ...d, [s.id]: t }))}
                        onBlur={() => {
                          const t = drafts[s.id];
                          if (t !== undefined && t.trim() !== value.trim()) void save(s, t.trim());
                        }}
                        onSubmitEditing={() => {
                          const next = rows[index + 1];
                          if (next) inputs.current.get(next.id)?.focus();
                        }}
                        returnKeyType={rows[index + 1] ? "next" : "done"}
                        blurOnSubmit={!rows[index + 1]}
                        keyboardType={field.type === "number" || field.type === "phone" ? "number-pad" : field.type === "email" ? "email-address" : "default"}
                        placeholder={field.label}
                        placeholderTextColor="#A3AEC2"
                        className="mt-2 h-11 rounded-xl border border-ink-200 bg-white px-3 text-[15px] text-ink-900"
                        style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
                      />
                    )}
                  </View>
                );
              }}
            />
          </>
        )}
      </SafeAreaView>
    </RnModal>
  );
}

/* ------------------------------------------------------------------ */
/* Photos & documents: one student after another                        */
/* ------------------------------------------------------------------ */

const isPdf = (p?: string | null) => /\.pdf($|\?)/i.test(String(p || "")) || String(p || "").startsWith("application/pdf");

function Thumb({ path, name, size, doc }: { path?: string; name: string; size: number; doc: boolean }) {
  const url = useAssetUrl(path && !isPdf(path) ? path : null);
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center overflow-hidden rounded-2xl bg-[#EEF3FF]">
      {url ? (
        <Image source={{ uri: url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      ) : path ? (
        <Ionicons name="document-text" size={Math.round(size * 0.42)} color="#047857" />
      ) : doc ? (
        <Ionicons name="document-outline" size={Math.round(size * 0.38)} color="#94A3B8" />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.36) }} className="font-semibold text-[#1F45C7]">
          {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function acceptOf(field: AdmissionFormField) {
  if (field.fileType === "image") return "image/*";
  if (field.fileType === "pdf") return "application/pdf,.pdf";
  return "image/*,application/pdf,.pdf";
}

/** Web: a file input; for photos it opens the phone's camera when there is one. */
function pickWeb(accept: string, camera: boolean): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (camera) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? { uri: URL.createObjectURL(file), name: file.name || "file", type: file.type || "application/octet-stream" } : null);
    };
    input.click();
  });
}

function UploadFlow({
  students,
  classes,
  field,
  token,
  saved,
  onSaved,
  onBack,
}: {
  students: Student[];
  classes: ClassRow[];
  field: AdmissionFormField;
  token: string | null;
  saved: Record<string, string>;
  onSaved: (studentId: string, path: string) => void;
  onBack: () => void;
}) {
  const photo = field.fileType === "image";
  const canCamera = field.fileType !== "pdf";
  const noun = photo ? "photo" : field.label.toLowerCase();
  const [classId, setClassId] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [currentId, setCurrentId] = useState("");
  const [camera, setCamera] = useState(false);
  const [shot, setShot] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView | null>(null);
  const native = Platform.OS !== "web";

  const pathOf = (s: Student) => saved[`${s.id}:${field.id}`] || s.admissionData?.[field.id] || "";
  const missingByClass = useMemo(() => {
    const m = new Map<string, number>();
    let all = 0;
    for (const s of students) {
      if (pathOf(s)) continue;
      all += 1;
      m.set(s.classId || "", (m.get(s.classId || "") || 0) + 1);
    }
    m.set("", all);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, saved, field.id]);
  const queue = useMemo(
    () =>
      students
        .filter((s) => !classId || s.classId === classId)
        .filter((s) => !onlyMissing || !s.admissionData?.[field.id] || saved[`${s.id}:${field.id}`])
        .sort(byClassThenRoll),
    [students, classId, onlyMissing, field.id, saved]
  );
  const todo = queue.filter((s) => !pathOf(s) && !skipped.has(s.id));
  const current = queue.find((s) => s.id === currentId) ?? todo[0] ?? null;
  const done = queue.filter((s) => pathOf(s)).length;

  function nextAfter(id: string) {
    setCurrentId(todo.filter((s) => s.id !== id)[0]?.id ?? "");
  }

  async function openCamera() {
    setError("");
    if (!native) {
      const file = await pickWeb(acceptOf(field), true);
      if (file) setShot(file);
      return;
    }
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setError("Camera access is off for Anekio. Turn it on in Settings.");
        return;
      }
    }
    setCamera(true);
  }

  async function chooseFile() {
    setError("");
    try {
      const file = native ? await pickFile(acceptOf(field), { ask: false }) : await pickWeb(acceptOf(field), false);
      if (file) setShot(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open files.");
    }
  }

  async function snap() {
    try {
      const pic = await camRef.current?.takePictureAsync({ quality: photo ? 0.5 : 0.7 });
      if (!pic?.uri) return;
      setShot({ uri: pic.uri, name: photo ? "photo.jpg" : "scan.jpg", type: "image/jpeg" });
      setCamera(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take the photo.");
    }
  }

  async function save() {
    if (!current || !shot) return;
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadFile(token, shot, { kind: "studentDocument", studentId: current.id, type: "CUSTOM_LETTER" });
      await act(token, "setStudentAdmissionFile", { studentId: current.id, fieldId: field.id, path: uploaded.path });
      onSaved(current.id, uploaded.path);
      setShot(null);
      nextAfter(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (camera) {
    const frame = photo ? { width: 240, height: 300 } : { width: 320, height: 204 };
    return (
      <View className="flex-1 bg-black">
        <CameraView ref={camRef} style={{ flex: 1 }} facing="back" onMountError={(e) => setError(e.message || "Could not start the camera.")} />
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <View style={frame} className="rounded-[24px] border-2 border-white/80" />
          <Text className="mt-3 text-[13px] text-white/90">{photo ? "Face in the frame" : `${field.label} in the frame`}</Text>
        </View>
        <View className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4 pt-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={() => setCamera(false)} className="h-10 w-10 items-center justify-center rounded-full bg-black/40">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text numberOfLines={1} className="mx-3 min-w-0 flex-1 text-center text-[15px] font-semibold text-white">{current?.name}</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="absolute bottom-8 left-0 right-0 items-center">
          <Pressable accessibilityRole="button" accessibilityLabel="Take photo" onPress={() => void snap()} className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/30">
            <View className="h-14 w-14 rounded-full bg-white" />
          </Pressable>
        </View>
      </View>
    );
  }

  const currentPath = current ? pathOf(current) : "";
  return (
    <>
      <ScreenHeader title={field.label} subtitle={`${done} of ${queue.length} uploaded`} onBack={onBack} backLabel="Back to fields" />
      <View className="h-1 bg-ink-100">
        <View className="h-full bg-emerald-500" style={{ width: `${queue.length ? Math.round((done / queue.length) * 100) : 0}%` }} />
      </View>
      <ClassChips
        classes={classes}
        value={classId}
        onChange={(id) => {
          setClassId(id);
          setCurrentId("");
          setShot(null);
        }}
        counts={missingByClass}
      />
      <ScrollView contentContainerClassName="pb-10">
        {current ? (
          <View className="mx-4 items-center rounded-3xl border border-ink-100 bg-[#F8FAFF] p-5">
            {shot ? (
              shot.type === "application/pdf" || isPdf(shot.name) ? (
                <View className="items-center justify-center rounded-3xl bg-emerald-50" style={{ width: 200, height: 160 }}>
                  <Ionicons name="document-text" size={48} color="#047857" />
                  <Text numberOfLines={1} className="mt-2 max-w-[180px] text-[12px] text-emerald-800">{shot.name}</Text>
                </View>
              ) : (
                <Image source={{ uri: shot.uri }} resizeMode="cover" style={photo ? { width: 200, height: 250, borderRadius: 24 } : { width: 280, height: 178, borderRadius: 18 }} />
              )
            ) : (
              <Thumb path={currentPath} name={current.name} size={132} doc={!photo} />
            )}
            <Text className="mt-4 text-center text-[20px] font-semibold text-ink-900">{current.name}</Text>
            <Text className="mt-0.5 text-[13px] text-ink-500">{[current.classLabel, Number(current.rollNumber) > 0 ? `Roll ${current.rollNumber}` : "", current.admissionNo].filter(Boolean).join(" · ")}</Text>
            {error ? <Text className="mt-3 text-center text-[13px] text-red-700">{error}</Text> : null}
            {shot ? (
              <View className="mt-5 w-full gap-2">
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} className="h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-[#1F45C7]">
                  {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={18} color="#fff" />}
                  <Text className="text-[15px] font-semibold text-white">{busy ? "Saving…" : "Save · next student"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => setShot(null)} className="h-11 items-center justify-center rounded-2xl">
                  <Text className="text-[14px] font-semibold text-ink-700">Take again</Text>
                </Pressable>
              </View>
            ) : (
              <View className="mt-5 w-full gap-2">
                {canCamera ? (
                  <Pressable accessibilityRole="button" onPress={() => void openCamera()} className="h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-[#1F45C7]">
                    <Ionicons name={photo ? "camera" : "scan"} size={18} color="#fff" />
                    <Text className="text-[15px] font-semibold text-white">{photo ? (currentPath ? "Retake photo" : "Take photo") : `Scan ${field.label}`}</Text>
                  </Pressable>
                ) : null}
                {!photo ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void chooseFile()}
                    className={`h-12 flex-row items-center justify-center gap-2 rounded-2xl ${canCamera ? "border border-ink-200 bg-white" : "bg-[#1F45C7]"}`}
                  >
                    <Ionicons name="folder-open-outline" size={18} color={canCamera ? "#334155" : "#fff"} />
                    <Text className={`text-[15px] font-semibold ${canCamera ? "text-ink-800" : "text-white"}`}>Choose file (PDF / image)</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSkipped((k) => new Set(k).add(current.id));
                    nextAfter(current.id);
                  }}
                  className="h-11 items-center justify-center rounded-2xl"
                >
                  <Text className="text-[14px] font-semibold text-ink-500">{photo ? "Skip · absent today" : "Skip · not brought"}</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <View className="mx-4 items-center rounded-3xl border border-emerald-100 bg-emerald-50 p-8">
            <Ionicons name="checkmark-circle" size={44} color="#10B981" />
            <Text className="mt-2 text-center text-[17px] font-semibold text-ink-900">{skipped.size ? "Done, except the ones you skipped" : `Everyone here has a ${noun}`}</Text>
            {skipped.size ? (
              <Pressable accessibilityRole="button" onPress={() => setSkipped(new Set())} className="mt-3 h-10 justify-center rounded-xl border border-ink-200 bg-white px-4">
                <Text className="text-[14px] font-semibold text-ink-800">{`Go through ${skipped.size} skipped`}</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View className="flex-row items-center justify-between px-4 pb-2 pt-5">
          <Text className="text-[13px] font-semibold text-ink-900">{classId ? classes.find((c) => c.id === classId)?.label : "All classes"}</Text>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: onlyMissing }} onPress={() => setOnlyMissing((v) => !v)} className="flex-row items-center gap-1.5">
            <Ionicons name={onlyMissing ? "checkbox" : "square-outline"} size={18} color={onlyMissing ? BLUE : "#94A3B8"} />
            <Text className="text-[13px] text-ink-700">Only missing</Text>
          </Pressable>
        </View>
        <View className="flex-row flex-wrap gap-3 px-4">
          {queue.map((s) => {
            const on = current?.id === s.id;
            const has = Boolean(pathOf(s));
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`${field.label} for ${s.name}`}
                onPress={() => {
                  setCurrentId(s.id);
                  setShot(null);
                  setError("");
                }}
                style={{ width: 72 }}
                className="items-center"
              >
                <View className={`rounded-[18px] p-0.5 ${on ? "bg-[#1F45C7]" : "bg-transparent"}`}>
                  <Thumb path={pathOf(s)} name={s.name} size={60} doc={!photo} />
                </View>
                {has ? (
                  <View className="absolute right-1 top-0 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500">
                    <Ionicons name="checkmark" size={11} color="#fff" />
                  </View>
                ) : null}
                <Text numberOfLines={1} className={`mt-1 text-[11px] ${on ? "font-semibold text-ink-900" : "text-ink-600"}`}>{s.name.split(" ")[0]}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </>
  );
}
