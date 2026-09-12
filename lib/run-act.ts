import type { AccessUser } from "./permissions";
import {
  addPeriodCore,
  addRoomCore,
  addSchoolHolidayCore,
  collectFeeCore,
  collectPartialFeesCore,
  changeOwnPasswordCore,
  createClassCore,
  admitLeadAsStudentCore,
  assignOfficeUserCore,
  copyRoleAccessCore,
  createCustomRoleCore,
  createOfficeUserCore,
  deleteCustomRoleCore,
  deletePeriodCore,
  deleteRoomCore,
  deleteSchoolHolidayCore,
  deleteSchoolSessionCore,
  createParentCore,
  createSchoolSessionCore,
  correctStaffAttendanceCore,
  saveStaffPayrollCore,
  createStaffMemberCore,
  createStudentCore,
  createTeacherCore,
  updateParentCore,
  updateStudentCore,
  updateStaffMemberCore,
  updateTeacherCore,
  ensureInvoiceShareTokenCore,
  ensurePayerPayLinkCore,
  enterMarksCore,
  hostExamCore,
  importSchoolHolidaysCore,
  issueDueFeesCoreApi,
  markAttendanceCore,
  markStaffAttendanceCore,
  publishNoticeCore,
  replyParentQueryCore,
  saveClassCurriculumCore,
  saveRoomsCore,
  saveExamPlanCore,
  createExamSeriesCore,
  publishExamSeriesCore,
  deleteExamSeriesCore,
  saveGradePolicyCore,
  applyLeaveCore,
  decideLeaveCore,
  assignSubstituteCore,
  saveLeavePolicyCore,
  saveSchoolPayrollRulesCore,
  sendClassNoteCore,
  submitParentQueryCore,
  saveSchoolClockCore,
  saveSchoolIdentityCore,
  saveSchoolWebsiteCore,
  saveAdmissionFeeSetupCore,
  saveSchoolSubjectsCore,
  saveTimetableSlotCore,
  sendStudentPayLinkCore,
  setCurrentSchoolSessionCore,
  setManagerCore,
  setRolePermissionsCore,
  setTeacherResourcesCore,
  updateAdmissionLeadCore,
  saveAdmissionFormCore,
  createAdmissionLeadCore,
} from "./core-actions";
import {
  archiveClassCore,
  approveExamMarksCore,
  collectAllStudentFeesCore,
  completeExamWorkCore,
  copyExamSeriesCore,
  examMarkHistoryCore,
  grantExamMarksCore,
  remindExamMarksCore,
  createInvoiceCore,
  importExamMarksCore,
  importPeopleSheetCore,
  issueClassFeesCore,
  publishExamResultsCore,
  requestExamMarkCorrectionCore,
  removeStudentFeeAddOnCore,
  returnExamMarksCore,
  reviewExamMarksCore,
  saveExamMarksCore,
  saveFeeTemplateCore,
  saveStudentFeeAddOnCore,
  saveSeriesMarksCore,
  sendFeeRemindersCore,
  startNextSchoolSessionCore,
  submitExamMarksCore,
  takeExamCore,
  updateExamSeriesPapersCore,
  uploadPaperCore,
  uploadQuestionPaperCore,
} from "./core-office";
import { issueFeeReceiptCore } from "./fee-register";
import { savePushTokenCore } from "./push";
import {
  applyOnboardingImport,
  previewOnboardingImport,
  saveOnboardingPlan,
  toggleOnboardingStep,
} from "./onboarding";
import {
  createOnboardingGoogleAuthUrl,
  createOnboardingGoogleSheet,
  previewOnboardingGoogleSheet,
} from "./onboarding-google";
import {
  archiveDocumentTemplateCore,
  changeIssuedDocumentStatusCore,
  issueDocumentCore,
  issueDocumentBatchCore,
  reissueDocumentCore,
  previewDocumentTemplateCore,
  publishDocumentTemplateCore,
  resolveStudentIdCardScanCore,
  saveDocumentTemplateCore,
} from "./document-studio";

export function actOp(body: Record<string, unknown>) {
  const op = String(body.op || body.action || "").trim();
  if (op) return op;
  if (Array.isArray(body.rows) && body.date) return "markStaffAttendance";
  if (body.startTime != null && body.graceMinutes != null && body.weekdays == null && body.rows == null) {
    return "saveSchoolPayrollRules";
  }
  return "";
}

export async function runAct(
  user: AccessUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const op = actOp(body);
  switch (op) {
    case "createStudent":
      await createStudentCore(user, body as never);
      break;
    case "admitLeadAsStudent":
      return { ok: true, ...(await admitLeadAsStudentCore(user, body as never)) };
    case "updateStudent":
      await updateStudentCore(user, body as never);
      break;
    case "createParent":
      await createParentCore(user, body as never);
      break;
    case "updateParent":
      await updateParentCore(user, body as never);
      break;
    case "createTeacher":
      await createTeacherCore(user, body as never);
      break;
    case "updateTeacher":
      await updateTeacherCore(user, body as never);
      break;
    case "createClass":
      await createClassCore(user, body as never);
      break;
    case "markAttendance":
      await markAttendanceCore(user, body as never);
      break;
    case "markStaffAttendance":
      return { ok: true, ...(await markStaffAttendanceCore(user, body as never)) };
    case "correctStaffAttendance":
      await correctStaffAttendanceCore(user, body as never);
      break;
    case "saveStaffPayroll":
      await saveStaffPayrollCore(user, body as never);
      break;
    case "createStaffMember":
      await createStaffMemberCore(user, body as never);
      break;
    case "updateStaffMember":
      await updateStaffMemberCore(user, body as never);
      break;
    case "publishNotice":
      await publishNoticeCore(user, body as never);
      break;
    case "submitParentQuery":
      await submitParentQueryCore(user, body as never);
      break;
    case "replyParentQuery":
      await replyParentQueryCore(user, body as never);
      break;
    case "saveSchoolIdentity":
      await saveSchoolIdentityCore(user, body as never);
      break;
    case "saveSchoolWebsite":
      return { ok: true, ...(await saveSchoolWebsiteCore(user, body as never)) };
    case "updateAdmissionLead":
      await updateAdmissionLeadCore(user, body as never);
      break;
    case "saveAdmissionForm":
      await saveAdmissionFormCore(user, body as never);
      break;
    case "createAdmissionLead":
      return { ok: true, ...(await createAdmissionLeadCore(user, body)) };
    case "saveDocumentTemplate":
      return { ok: true, template: await saveDocumentTemplateCore(user, body) };
    case "publishDocumentTemplate":
      return { ok: true, ...(await publishDocumentTemplateCore(user, body)) };
    case "archiveDocumentTemplate":
      await archiveDocumentTemplateCore(user, body);
      break;
    case "issueDocument":
      return { ok: true, ...(await issueDocumentCore(user, body)) };
    case "issueDocumentBatch":
      return { ok: true, ...(await issueDocumentBatchCore(user, body)) };
    case "reissueDocument":
      return { ok: true, ...(await reissueDocumentCore(user, body)) };
    case "previewDocumentTemplate":
      return { ok: true, html: await previewDocumentTemplateCore(user, body) };
    case "resolveStudentIdCardScan":
      return { ok: true, ...(await resolveStudentIdCardScanCore(user, body)) };
    case "changeIssuedDocumentStatus":
      await changeIssuedDocumentStatusCore(user, body);
      break;
    case "createSchoolSession":
      await createSchoolSessionCore(user, body as never);
      break;
    case "setCurrentSchoolSession":
      await setCurrentSchoolSessionCore(user, body as never);
      break;
    case "deleteSchoolSession":
      await deleteSchoolSessionCore(user, body as never);
      break;
    case "startNextSchoolSession":
      await startNextSchoolSessionCore(user);
      break;
    case "addSchoolHoliday":
      await addSchoolHolidayCore(user, body as never);
      break;
    case "deleteSchoolHoliday":
      await deleteSchoolHolidayCore(user, body as never);
      break;
    case "importSchoolHolidays":
      await importSchoolHolidaysCore(user, body as never);
      break;
    case "saveGradePolicy":
      await saveGradePolicyCore(user, body as never);
      break;
    case "saveExamPlan":
      await saveExamPlanCore(user, body as never);
      break;
    case "saveTimetableSlot":
      await saveTimetableSlotCore(user, body as never);
      break;
    case "saveClassCurriculum":
      await saveClassCurriculumCore(user, body as never);
      break;
    case "setTeacherResources":
      await setTeacherResourcesCore(user, body as never);
      break;
    case "saveSchoolSubjects":
      await saveSchoolSubjectsCore(user, body as never);
      break;
    case "saveSchoolClock":
      await saveSchoolClockCore(user, body as never);
      break;
    case "saveLeavePolicy":
      await saveLeavePolicyCore(user, body as never);
      break;
    case "saveSchoolPayrollRules":
    case "saveLateTiming":
    case "savePayrollRules":
      return { ok: true, ...(await saveSchoolPayrollRulesCore(user, body as never)) };
    case "applyLeave":
      await applyLeaveCore(user, body as never);
      break;
    case "decideLeave":
      await decideLeaveCore(user, body as never);
      break;
    case "assignSubstitute":
      await assignSubstituteCore(user, body as never);
      break;
    case "setManager":
      await setManagerCore(user, {
        userId: String(body.userId || ""),
        managerId: body.managerId == null || body.managerId === "" ? null : String(body.managerId),
      });
      break;
    case "sendClassNote":
      await sendClassNoteCore(user, body as never);
      break;
    case "addPeriod":
      return { ok: true, ...(await addPeriodCore(user, body as never)) };
    case "deletePeriod":
      await deletePeriodCore(user, body as never);
      break;
    case "saveRooms":
      await saveRoomsCore(user, body as never);
      break;
    case "addRoom":
      await addRoomCore(user, body as never);
      break;
    case "deleteRoom":
      await deleteRoomCore(user, body as never);
      break;
    case "collectFee":
      await collectFeeCore(user, body as never);
      break;
    case "collectPartialFees":
      await collectPartialFeesCore(user, body as never);
      break;
    case "collectAllStudentFees":
      await collectAllStudentFeesCore(user, body as never);
      break;
    case "issueDueFees":
      await issueDueFeesCoreApi(user, body as never);
      break;
    case "issueClassFees":
      await issueClassFeesCore(user, body as never);
      break;
    case "createInvoice":
      await createInvoiceCore(user, body as never);
      break;
    case "saveFeeTemplate":
      return { ok: true, ...(await saveFeeTemplateCore(user, body as never)) };
    case "saveAdmissionFeeSetup":
      return { ok: true, ...(await saveAdmissionFeeSetupCore(user, body as never)) };
    case "saveStudentFeeAddOn":
      await saveStudentFeeAddOnCore(user, body as never);
      break;
    case "removeStudentFeeAddOn":
      await removeStudentFeeAddOnCore(user, body as never);
      break;
    case "sendFeeReminders":
      return { ok: true, ...(await sendFeeRemindersCore(user, body as never)) };
    case "issueFeeReceipt":
      return { ok: true, ...(await issueFeeReceiptCore(user, body as never)) };
    case "enterMarks":
      await enterMarksCore(user, body as never);
      break;
    case "hostExam":
      await hostExamCore(user, body as never);
      break;
    case "createExamSeries":
      await createExamSeriesCore(user, body as never);
      break;
    case "publishExamSeries":
      await publishExamSeriesCore(user, body as never);
      break;
    case "deleteExamSeries":
      await deleteExamSeriesCore(user, body as never);
      break;
    case "copyExamSeries":
      return { ok: true, ...(await copyExamSeriesCore(user, body as never)) };
    case "updateExamSeriesPapers":
      await updateExamSeriesPapersCore(user, body as never);
      break;
    case "completeExamWork":
      await completeExamWorkCore(user, body as never);
      break;
    case "saveExamMarks":
      return { ok: true, ...(await saveExamMarksCore(user, body as never)) };
    case "takeExam":
      await takeExamCore(user, body as never);
      break;
    case "submitExamMarks":
      return { ok: true, ...(await submitExamMarksCore(user, body as never)) };
    case "reviewExamMarks":
      await reviewExamMarksCore(user, body as never);
      break;
    case "returnExamMarks":
      await returnExamMarksCore(user, body as never);
      break;
    case "requestExamMarkCorrection":
      await requestExamMarkCorrectionCore(user, body as never);
      break;
    case "examMarkHistory":
      return { ok: true, ...(await examMarkHistoryCore(user, body as never)) };
    case "remindExamMarks":
      await remindExamMarksCore(user, body as never);
      break;
    case "approveExamMarks":
      await approveExamMarksCore(user, body as never);
      break;
    case "publishExamResults":
      return { ok: true, ...(await publishExamResultsCore(user, body as never)) };
    case "importExamMarks":
      return { ok: true, ...(await importExamMarksCore(user, body as never)) };
    case "saveSeriesMarks":
      await saveSeriesMarksCore(user, body as never);
      break;
    case "uploadPaper":
      await uploadPaperCore(user, body as never);
      break;
    case "uploadQuestionPaper":
      await uploadQuestionPaperCore(user, body as never);
      break;
    case "grantExamMarks":
      await grantExamMarksCore(user, body as never);
      break;
    case "importPeopleSheet":
      return { ok: true, ...(await importPeopleSheetCore(user, body as never)) };
    case "saveOnboardingPlan":
      return { ok: true, ...(await saveOnboardingPlan(user, body as never)) };
    case "toggleOnboardingStep":
      return { ok: true, ...(await toggleOnboardingStep(user, body as never)) };
    case "connectOnboardingGoogleSheets":
      return { ok: true, ...(await createOnboardingGoogleAuthUrl(user, body as never)) };
    case "createOnboardingGoogleSheet":
      return { ok: true, ...(await createOnboardingGoogleSheet(user, body as never)) };
    case "previewOnboardingGoogleSheet":
      return { ok: true, ...(await previewOnboardingGoogleSheet(user, body as never)) };
    case "previewOnboardingImport":
      return { ok: true, ...(await previewOnboardingImport(user, body as never)) };
    case "applyOnboardingImport":
      return { ok: true, ...(await applyOnboardingImport(user, body as never)) };
    case "archiveClass":
      await archiveClassCore(user, body as never);
      break;
    case "changePassword":
      await changeOwnPasswordCore(user, {
        current: String(body.current || ""),
        next: String(body.next || ""),
      });
      break;
    case "savePushToken":
      await savePushTokenCore(user, { token: String(body.token || "") });
      break;
    case "ensurePayToken": {
      const token = await ensureInvoiceShareTokenCore(user, String(body.invoiceId || ""));
      return { ok: true, token };
    }
    case "ensurePayLink": {
      const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.map(String) : [];
      const link = await ensurePayerPayLinkCore(user, {
        studentId: String(body.studentId || ""),
        invoiceIds,
      });
      return { ok: true, ...link };
    }
    case "sendPayLink": {
      const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.map(String) : [];
      await sendStudentPayLinkCore(user, {
        studentId: String(body.studentId || ""),
        invoiceIds,
        channel: body.channel === "email" ? "email" : "whatsapp",
      });
      break;
    }
    case "setRolePermissions":
      await setRolePermissionsCore(user, body as never);
      break;
    case "createCustomRole":
      await createCustomRoleCore(user, body as never);
      break;
    case "createOfficeUser":
      await createOfficeUserCore(user, body as never);
      break;
    case "assignOfficeUser":
      await assignOfficeUserCore(user, body as never);
      break;
    case "copyRoleAccess":
      await copyRoleAccessCore(user, body as never);
      break;
    case "deleteCustomRole":
      await deleteCustomRoleCore(user, body as never);
      break;
    default:
      if (body.startTime != null && body.graceMinutes != null && body.weekdays == null && body.rows == null) {
        return { ok: true, ...(await saveSchoolPayrollRulesCore(user, body as never)) };
      }
      throw Object.assign(new Error(op ? `Unknown action: ${op}` : "Unknown action"), { status: 400 });
  }
  return { ok: true };
}
