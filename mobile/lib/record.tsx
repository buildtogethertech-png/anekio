import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { getChildId, setChildId as persistChildId } from "./storage";

export type DocumentElementType = "TEXT" | "FIELD" | "IMAGE" | "PHOTO" | "TABLE" | "SIGNATURE" | "STAMP" | "VERIFY_QR" | "CUSTOM_QR" | "BARCODE" | "SHAPE" | "LINE" | "PAGE_NUMBER";
export type DocumentElement = {
  id: string;
  type: DocumentElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  value?: string;
  field?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  align?: "left" | "center" | "right";
  color?: string;
  background?: string;
  borderColor?: string;
  locked?: boolean;
};
export type DocumentLayout = { elements: DocumentElement[] };
export type DocumentTemplateSummary = {
  id: string;
  builtIn: boolean;
  type: string;
  category: string;
  name: string;
  description: string;
  pageSize: string;
  orientation: string;
  status: string;
  activeVersion: number | null;
  hasDraft?: boolean;
  updatedAt: string | null;
  layout: DocumentLayout;
};

export type AdmissionFormField = {
  id: string;
  label: string;
  type: "text" | "email" | "phone" | "number" | "date" | "textarea" | "select" | "radio" | "multi" | "checkbox" | "file";
  required: boolean;
  visible: boolean;
  options: string[];
  builtin: boolean;
  helpText?: string;
  fileType?: "image" | "pdf" | "image_pdf";
  maxFileSizeMb?: number;
};

export type RecordPayload = {
  kind: "PARENT" | "STUDENT" | "TEACHER" | "OFFICE";
  onboarding?: {
    modules: string[];
    progress: { completed: number; total: number; percent: number };
    counts: { classes: number; students: number; teachers: number; openingBalances: number; feeTemplates: number };
    steps: {
      key: string;
      area: "school" | "teaching" | "money" | "documents";
      number: number;
      title: string;
      body: string;
      target: { href: string; label: string };
      dataComplete: boolean;
      manualComplete: boolean;
      missingReason: string;
      status: "complete" | "ready" | "blocked" | "optional";
    }[];
    templates: {
      kind: "students" | "teachers" | "class_teachers" | "opening_balances";
      title: string;
      fileName: string;
      disabled: boolean;
      prerequisite: string;
    }[];
    imports: {
      id: string;
      kind: string;
      fileName: string;
      status: string;
      created: number;
      updated: number;
      createdAt: string;
      appliedAt: string;
      errors: string[];
    }[];
    googleSheets: {
      id: string;
      kind: string;
      name: string;
      webViewLink: string;
      createdAt: string;
      reviewedAt: string;
      importId: string;
    }[];
  } | null;
  subscriptionLock?: {
    locked: true;
    orgId: string;
    schoolName: string;
    status: string;
    renewalOn: string;
    renewUrl: string;
    amount: number;
  };
  subscription?: {
    orgId: string;
    schoolName: string;
    plan: string;
    status: string;
    paymentStatus: string;
    subscriptionStart: string;
    renewalOn: string;
    daysLeft: number | null;
    renewUrl: string;
    amount: number;
    invoices: {
      id: string;
      number: string;
      description: string;
      status: string;
      issueDate: string;
      dueDate: string;
      total: number;
      paid: number;
      balance: number;
      notes: string;
      printUrl: string;
    }[];
  } | null;
  children?: {
    id: string;
    name: string;
    classLabel: string;
    admissionNo?: string;
    born?: string;
    email?: string;
    interests?: string[];
  }[];
  parent?: {
    name: string;
    email: string;
    phone: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    place?: string;
  } | null;
  child?: {
    id: string;
    name: string;
    classLabel: string;
    admissionNo: string;
    born?: string;
    email?: string;
    parentName?: string;
    parentPhone?: string;
    parentEmail?: string;
    interests: string[];
    attendance: { id: string; date: string; rawDate?: string; status: string }[];
    subjects: {
      name: string;
      pct: number;
      n: number;
      hint: string;
      teacher?: string;
      week?: { day: string; period: string; start: string; end: string }[];
      nextTest?: { title: string; date: string } | null;
    }[];
    tests: { id: string; examId?: string; seriesId?: string; seriesName?: string; title: string; subject: string; date?: string; marks: number; max: number; pct: number; remarks: string; absent?: boolean }[];
    papers: {
      id: string;
      examId?: string;
      seriesId?: string;
      title: string;
      type: string;
      subject: string;
      notes: string;
      teacher: string;
      date: string;
      fileName: string;
      fileUrl?: string;
    }[];
    path: {
      id: string;
      title: string;
      type: string;
      level: string;
      description: string;
      rank: number | null;
      result: string;
      score: number | null;
    }[];
    letter: { lines: string[]; paths: string[] };
    fees: {
      id: string;
      title: string;
      due: string;
      amount: string;
      paid: string;
      remaining: string;
      dueNow: number;
      period: string;
      dueAt: string;
      display: string;
      lateLabel: string;
      lines: string[];
      token: string;
      payUrl?: string;
    }[];
  } | null;
  upcoming?: { id: string; title: string; subject: string; date: string; time?: string; resultDate?: string; teacher: string; seriesId?: string; seriesName?: string }[];
  examTimetable?: { id: string; title: string; subject: string; date: string; time?: string; resultDate?: string; teacher: string; seriesId?: string; seriesName?: string }[];
  examSessions?: {
    id: string;
    name: string;
    sessionLabel: string;
    status: "published" | "upcoming" | "held" | "unpublished";
    examLabel: string;
    examDate: string;
    resultDate: string;
  }[];
  notices?: { id: string; title: string; body: string; createdAt: string; author: string }[];
  reports?: {
    seriesId: string;
    seriesName: string;
    sessionLabel: string;
    classLabel: string;
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
    exams: { id: string; title: string; maxMarks: number; date: string; subject: { id?: string; name: string } }[];
    marks: { examId: string; studentId: string; marks: number; absent?: boolean; remarks?: string | null }[];
    classmates: { id: string; name: string }[];
    policy: { bands: { min: number; grade: string }[]; passPercent: number; showRank: boolean; reportCardPaidMonths?: number };
  }[];
  reportCardHold?: { requiredMonths: number; paidMonths: number } | null;
  timetable?: {
    weekdays: { n: number; label: string }[];
    periods: { id: string; name: string; start: string; end: string; isBreak?: boolean; sortOrder?: number }[];
    rooms?: { id: string; name: string; kind: string }[];
    teachers?: {
      id: string;
      name: string;
      qualification?: string;
      idle?: boolean;
      team?: boolean;
      skills: { subjectName: string; classId: string }[];
    }[];
    weekCapacity?: number;
    slots?: {
      weekday: number;
      periodId?: string;
      period: string;
      subject: string;
      teacher: string;
      room: string;
      classLabel: string;
    }[];
    classes?: {
      id?: string;
      label: string;
      name?: string;
      section?: string;
      subjects?: { id: string; name: string; weightage?: number }[];
      slots: {
        id?: string;
        weekday: number;
        periodId?: string;
        period: string;
        subjectId?: string;
        subject: string;
        teacherId?: string;
        teacher: string;
        room: string;
        covers?: { date: string; substituteId: string; substitute: string; absentTeacher: string }[];
      }[];
    }[];
  } | null;
  classLabel?: string;
  classId?: string;
  classTeacher?: boolean;
  markedToday?: boolean;
  studentCount?: number;
  outToday?: string[];
  todos?: {
    id: string;
    title: string;
    hint: string;
    href?: string;
    examId?: string;
    kind?: "paper" | "copies" | "marks" | "take";
    dueOn?: string;
    urgency?: "overdue" | "soon" | "";
  }[];
  doneWork?: {
    id: string;
    examId: string;
    kind: "paper" | "take" | "marks";
    title: string;
    hint: string;
    doneAt: string;
    examDate?: string;
  }[];
  markSheets?: {
    examId: string;
    title: string;
    subject: string;
    maxMarks: number;
    classLabel: string;
    date?: string;
    seriesName?: string;
    workflowStatus?: string;
    correctionNote?: string;
    entered?: number;
    canEnterMarks?: boolean;
    students: { id: string; name: string; admissionNo: string; marks: number | null; absent: boolean; correctionNote?: string; correctionRequested?: boolean }[];
  }[];
  callHome?: { id: string; name: string; days: number; parentName: string; phone: string; wa: string }[];
  weekPapers?: { id: string; title: string; subject: string; date: string; classLabel: string }[];
  needsAttention?: string[];
  breakout?: number;
  subjects?: { id: string; name: string }[];
  roster?: {
    id: string;
    name: string;
    admissionNo?: string;
    today: string;
    dateOfBirth?: string;
    parentName?: string;
    phone?: string;
    days?: { date: string; status: string }[];
  }[];
  exams?: { id: string; title: string; hint?: string; label?: string; students?: number; examId?: string; kind?: string }[];
  desk?: {
    label?: string;
    emptyPeriods: number;
    idleStaff: number;
    teacherAbsent?: number;
    unmarked?: number;
    overdueCount?: number;
    dueNow?: string;
    pendingBills?: number;
    openBills?: number;
    school: string;
    holes?: { classId: string; classLabel: string; count: number }[];
    idleNow?: { id: string; name: string; employeeId: string }[];
    didNotCome?: { id: string; label: string }[];
    todayAmount?: string;
    weekAmount?: string;
    series?: { label: string; amount: number; isToday: boolean }[];
    classAttendance?: {
      classId: string;
      label: string;
      total: number;
      present: number;
      absent: number;
      unmarked: number;
      percent: number;
      teacherId: string;
      teacherName: string;
      teacherPhone: string;
      teacherStatus: string;
      managerName: string;
      managerPhone: string;
    }[];
  };
  classes?: {
    id: string;
    label: string;
    name?: string;
    section?: string;
    students?: number;
    subjects?: { id: string; name: string; teacherId?: string }[];
  }[];
  feeTemplates?: {
    id: string;
    classId: string;
    sessionId: string;
    name: string;
    startsPeriod?: string;
    endsPeriod?: string;
    dueDay: number;
    lateKind: string;
    lateGraceDays: number;
    lateAmount: number;
    lines: { label: string; kind: string; amount: number; scope?: string }[];
  }[];
  admissionFeeLines?: { id: string; classId: string; label: string; amount: number; sortOrder: number }[];
  people?: {
    id: string;
    name: string;
    classId?: string;
    classLabel: string;
    parent: string;
    parentPhone?: string;
    admissionNo: string;
    path?: string[];
    feeLabel?: string;
    feeTone?: string;
    billed?: string;
    paid?: string;
    dueNow?: string;
    parentId?: string;
    parentEmail?: string;
    parentAddress?: string;
    parentStreet?: string;
    parentCity?: string;
    parentState?: string;
    parentPincode?: string;
    born?: string;
    dateOfBirth?: string;
    dueAmount?: number;
    overdueCount?: number;
    feeAddOns?: {
      id: string;
      label: string;
      kind: string;
      amount: number;
      cadence: string;
      startsPeriod: string;
      endsPeriod: string;
    }[];
    attendance?: { status: string }[];
    invoiceIds?: string[];
    invoices?: {
      id: string;
      title: string;
      period?: string;
      due: string;
      amount: string;
      paid: string;
      remaining: string;
      dueNow?: number;
      lateLabel?: string;
      status: string;
      invoiceUrl?: string;
      receiptUrl?: string;
      receiptNumber?: string;
    }[];
  }[];
  peopleTeachers?: {
    id: string;
    userId?: string;
    name: string;
    email: string;
    phone?: string;
    employeeId: string;
    role: string;
    qualification?: string;
    classId?: string;
    classLabel?: string;
    managerId?: string;
    managerName?: string;
  }[];
  peopleParents?: {
    id: string;
    name: string;
    email: string;
    phone: string;
    children: { id: string; name: string; classId?: string; classLabel: string }[] | string;
    address?: string;
    street?: string;
    city?: string;
    state?: string;
    pincode?: string;
    childCount?: number;
  }[];
  staff?: {
    id: string;
    userId?: string;
    kind?: "teacher" | "staff";
    name: string;
    email?: string;
    employeeId?: string;
    roleId?: string;
    role: string;
    phone: string;
    qualification?: string;
    classId?: string;
    classLabel?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    joinedOn?: string;
    today?: string;
    days?: {
      date: string;
      status: string;
      remark?: string;
      inAt?: string;
      outAt?: string;
      startTimeUsed?: string;
      computedStatus?: string;
    }[];
    leaveDays?: { date: string; reason: string; paid: boolean; typeName: string }[];
    salary?: number;
    department?: string;
    managerId?: string;
    managerName?: string;
  }[];
  payrollRules?: {
    presentCredit: number;
    absentCredit: number;
    paidLeaveCredit: number;
    unpaidLeaveCredit: number;
    halfDayCredit: number;
    lateCredit: number;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    freeLateCount: number;
    lateDeductionMode: string;
    lateDeductionAmount: number;
    lateDayFraction: number;
    latesPerLeaveDay: number;
  };
  staffPayroll?: {
    personKey: string;
    month: string;
    status: string;
    salary: number;
    workingDays: number;
    payableDays: number;
    attendanceAdj: number;
    otherAdj: number;
    finalAmount: number;
  }[];
  staffAudits?: {
    personKey: string;
    date: string;
    fromStatus: string;
    toStatus: string;
    reason: string;
    at: string;
  }[];
  managers?: { id: string; name: string; role: string; slug?: string; portal?: string }[];
  teamWeek?: boolean;
  team?: {
    emptyPeriods: number;
    idleNow: { id: string; name: string; employeeId: string; team?: boolean }[];
    holes: { classId: string; classLabel: string; count: number }[];
    people: { userId: string; name: string; role: string; teacherId: string }[];
  };
  staffRoles?: { id: string; name: string; portal: string; slug?: string; isSystem?: boolean }[];
  school?: {
    name: string;
    phone: string;
    email: string;
    address: string;
    city?: string;
    state?: string;
    pincode?: string;
    affiliation?: string;
    gstin?: string;
    pan?: string;
    upiId?: string;
    bankName?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    signatory?: string;
    invoiceStyle?: string;
    logoPath?: string;
    signPath?: string;
    stampPath?: string;
    sessionStart?: string;
    sessionEnd?: string;
    sessionId?: string;
    sessionLabel?: string;
    admissionCharge?: number;
    admissionForm?: AdmissionFormField[];
    whatsappCommunityUrl?: string;
    website?: {
      enabled: boolean;
      slug: string;
      domain: string;
      theme: string;
      heroTitle: string;
      heroSubtitle: string;
      about: string;
      highlights: string[];
      facilities: string[];
      gallery: string[];
      admissionOpen: boolean;
      admissionNote: string;
    };
    admissionLeads?: {
      id: string;
      studentName: string;
      guardianName: string;
      phone: string;
      email: string;
      classWanted: string;
      message: string;
      customFields: Record<string, string>;
      source: string;
      status: string;
      followUpAt: string;
      notes: string;
      createdAt: string;
      updatedAt: string;
      events?: {
        id: string;
        kind: string;
        title: string;
        body: string;
        actorName: string;
        createdAt: string;
      }[];
    }[];
    subjectCatalog?: string[];
    sessions?: { id: string; label: string; startsOn: string; endsOn: string; current: boolean }[];
    holidays?: { id: string; sessionId?: string; date: string; name: string }[];
    policy?: { bands: { min: number; grade: string }[]; passPercent: number; showRank: boolean; reportCardPaidMonths?: number };
    plan?: { id: string; name: string; kind: string; weight: number; maxMarks: number; expectedPeriod?: string }[];
    pay?: {
      gateway: string;
      testMode: boolean;
      razorpayKeyId: string;
      razorpaySecretSet: boolean;
      razorpayWebhookSet: boolean;
      cashfreeAppId: string;
      cashfreeSecretSet: boolean;
      billdeskMerchantId: string;
      billdeskClientId: string;
      billdeskSecretSet: boolean;
      aisensyKeySet: boolean;
      aisensyCampaign: string;
      resendKeySet: boolean;
      resendFromEmail: string;
    };
  };
  fees?: {
    id: string;
    title: string;
    student?: string;
    studentId?: string;
    classId?: string;
    classLabel?: string;
    amount: string;
    paid: string;
    remaining?: number;
    status: string;
  }[];
  examPack?: {
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
    policy: { bands: { min: number; grade: string }[]; passPercent: number; showRank: boolean; reportCardPaidMonths?: number };
    planBySession: Record<string, { id: string; name: string; kind: string; weight: number; maxMarks: number; expectedPeriod?: string }[]>;
    series: {
      id: string;
      classId: string;
      sessionId: string;
      sessionLabel: string;
      sessionCurrent: boolean;
      planItemId: string;
      name: string;
      published: boolean;
      exams: {
        id: string;
        title: string;
        maxMarks: number;
        date: string;
        paperDueOn?: string | null;
        copiesDueOn?: string | null;
        resultOn?: string | null;
        teacherId?: string | null;
        teacherName?: string;
        setterId?: string | null;
        setterName?: string;
        evaluators?: { id: string; name: string }[];
        eligibleTeacherIds?: string[];
        subject: { id: string; name: string };
        workflowStatus?: string;
        correctionNote?: string;
        entered?: number;
        paperAt?: string | null;
        marksGrantedAt?: string | null;
        conductedAt?: string | null;
        paperFileName?: string | null;
        resultsPublishedAt?: string | null;
      }[];
      marks: { examId: string; studentId: string; marks: number; absent?: boolean; remarks?: string | null; version?: number; correctionNote?: string; correctionRequested?: boolean }[];
    }[];
  };
  examList?: { id: string; title: string; classId?: string; label?: string }[];
  examStudents?: { id: string; name: string; admissionNo?: string; classId: string }[];
  documentStudio?: {
    categories: { id: string; label: string; hint: string }[];
    types: { id: string; label: string; category: string; hint: string; priority?: boolean }[];
    fields: { group: string; id: string; label: string }[];
    defaults: DocumentTemplateSummary[];
    templates: DocumentTemplateSummary[];
    issued: {
      id: string;
      documentNumber: string;
      type: string;
      subjectType: string;
      subjectId: string;
      subjectLabel: string;
      status: string;
      issuedAt: string;
      batchId?: string | null;
      verifyUrl: string;
      documentUrl: string;
      templateName: string;
      version: number;
    }[];
  } | null;
  examPapers?: { id: string; name: string; classId: string }[];
  roles?: {
    id: string;
    name: string;
    slug?: string;
    portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT";
    description?: string;
    isSystem?: boolean;
    users: number;
    grants?: string[];
    grantScopes?: Record<string, "SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL">;
  }[];
  officeUsers?: { id: string; name: string; email: string; roleId: string; managerId?: string; managerName?: string }[];
  permissionCatalog?: {
    key: string;
    group: string;
    label: string;
    hint?: string;
    see?: boolean;
    portals: string[];
    scopes: ("SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL")[];
    defaultScope: "SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL";
    scopePolicies?: Partial<
      Record<
        "OFFICE" | "TEACHER" | "PARENT" | "STUDENT",
        {
          scopes: ("SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL")[];
          defaultScope: "SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL";
        }
      >
    >;
  }[];
  teachers?: { id: string; name: string }[];
  leaveTypes?: {
    id: string;
    name: string;
    forTeacher: boolean;
    forStaff: boolean;
    forStudent: boolean;
    eligibilityGender: string;
    noticeDays: number;
    yearlyCap: number;
    sortOrder: number;
  }[];
  myLeave?: LeaveRow[];
  pendingLeave?: LeaveRow[];
  upcomingLeave?: UpcomingTeacherLeaveRow[];
  calendar?: { weekdays: number[]; holidays: { date: string; name: string }[] };
};

export type LeaveRow = {
  id: string;
  typeId: string;
  typeName: string;
  from: string;
  to: string;
  reason: string;
  status: "ACTIVE" | "WAITING" | "REJECTED";
  who: "teacher" | "staff" | "student";
  subjectId: string;
  subjectName: string;
  classLabel: string;
  waitingOn: "guardian" | "teacher" | "";
  days: number;
};

export type UpcomingTeacherLeaveRow = {
  requestId: string;
  teacherId: string;
  teacherName: string;
  typeName: string;
  from: string;
  to: string;
  reason: string;
  covered: number;
  total: number;
  slots: {
    slotId: string;
    date: string;
    period: string;
    startsAt: string;
    endsAt: string;
    classLabel: string;
    subject: string;
    room: string;
    substituteId: string;
    substituteName: string;
    candidates: { id: string; name: string; match: boolean }[];
  }[];
};

type Ctx = {
  data: RecordPayload | null;
  error: string;
  refreshing: boolean;
  childId?: string;
  setChildId: (id: string) => void;
  reload: () => Promise<void>;
};

const RecordContext = createContext<Ctx | null>(null);

export function RecordProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const [data, setData] = useState<RecordPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [childId, setChildId] = useState<string | undefined>();
  const [childReady, setChildReady] = useState(false);

  useEffect(() => {
    getChildId()
      .then((id) => {
        if (id) setChildId(id);
      })
      .finally(() => setChildReady(true));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    const q = childId ? `?childId=${encodeURIComponent(childId)}` : "";
    const next = await api<RecordPayload>(`/record${q}`, token);
    setData(next);
  }, [token, childId]);

  useEffect(() => {
    if (!childReady || !token) return;
    setError("");
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, [reload, childReady, token]);

  async function onSetChild(id: string) {
    setChildId(id);
    await persistChildId(id);
  }

  return (
    <RecordContext.Provider
      value={{
        data,
        error,
        refreshing,
        childId,
        setChildId: onSetChild,
        reload: async () => {
          setRefreshing(true);
          try {
            await reload();
          } finally {
            setRefreshing(false);
          }
        },
      }}
    >
      {children}
    </RecordContext.Provider>
  );
}

export function useRecord() {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error("useRecord");
  return ctx;
}
