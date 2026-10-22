import type { AccessUser } from "./permissions";
import { adminSetPasswordCore } from "./admin-password";
import {
  markStudentLeftCore,
  pastStudentsCore,
  prepareNextYearCore,
  promotionBoardCore,
  resetPromotionClassCore,
  restoreStudentCore,
  savePromotionDecisionsCore,
  schoolYearSummaryCore,
  switchToNextYearCore,
  undoYearSwitchCore,
} from "./promotion";
import { setStaffTeachingCore } from "./staff-teaching";
import {
  addPeriodCore,
  addRoomCore,
  addSchoolHolidayCore,
  collectFeeCore,
  collectPartialFeesCore,
  changeOwnPasswordCore,
  createClassCore,
  updateClassCore,
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
  generateStaffAttendanceQrCore,
  saveStaffPayrollCore,
  createStaffMemberCore,
  setStaffOnboardingFileCore,
  createStudentCore,
  setTeacherClassSubjectsCore,
  setUnpaidLeaveCore,
  applySchoolClockCore,
  copyTimetableDayCore,
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
  createExamCore,
  updateExamItemCore,
  deleteExamItemCore,
  addCbseExamsCore,
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
  checkSchoolWebsiteSlugCore,
  saveSchoolIdentityCore,
  saveSchoolWebsiteCore,
  saveAdmissionFeeSetupCore,
  saveSchoolSubjectsCore,
  scanStaffAttendanceQrCore,
  saveTimetableSlotCore,
  sendStudentPayLinkCore,
  setCurrentSchoolSessionCore,
  setManagerCore,
  setRolePermissionsCore,
  setTeacherResourcesCore,
  updateAdmissionLeadCore,
  saveAdmissionFormCore,
  saveStaffOnboardingFormCore,
  createAdmissionLeadCore,
  setStudentAdmissionFileCore,
  saveWebsiteFormCore,
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
  saveFeeCatalogCore,
  applySessionLateFeeCore,
  applySessionDueDayCore,
  saveFeeAcademicSessionCore,
  assignStudentFeesCore,
  saveSeriesMarksCore,
  sendFeeRemindersCore,
  startNextSchoolSessionCore,
  submitExamMarksCore,
  takeExamCore,
  updateExamSeriesPapersCore,
  reassignExamTeacherCore,
  uploadPaperCore,
  uploadQuestionPaperCore,
  handOverExamPaperCore,
  receiveExamPaperCore,
  returnExamPaperCore,
  undoExamPaperHandoverCore,
} from "./core-office";
import { issueFeeReceiptCore } from "./fee-register";
import { savePushTokenCore } from "./push";
import { pastExamMarksCore, readPastExamSheetCore, savePastExamMarksCore } from "./past-exams";
import { reassignExamRoleCore, scheduleExamForClassesCore } from "./exam-schedule-all";
import { editPublishedMarksCore } from "./exam-mark-edits";
import { confirmMyContactChangeCore, getMyAccountCore, requestMyContactChangeCore, updateMyNameCore } from "./my-account";
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
  uploadStudentDocumentCore,
} from "./document-studio";
import { startInboxThreadCore, sendInboxMessageCore, updateInboxThreadCore } from "./inbox";
import { reviewProfileRequestCore, submitProfileRequestCore } from "./profile-requests";
import { recordStaffSalaryPaymentCore, recordStaffSalaryPaymentsBulkCore, voidStaffSalaryPaymentCore } from "./salary-payments";

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
    case "copyTimetableDay":
      return { ok: true, ...(await copyTimetableDayCore(user, body as never)) };
    case "setTeacherClassSubjects":
      return { ok: true, ...(await setTeacherClassSubjectsCore(user, body as never)) };
    case "createStudent":
      return { ok: true, ...(await createStudentCore(user, body as never)) };
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
    case "updateClass":
      await updateClassCore(user, body as never);
      break;
    case "markAttendance":
      await markAttendanceCore(user, body as never);
      break;
    case "markStaffAttendance":
      return { ok: true, ...(await markStaffAttendanceCore(user, body as never)) };
    case "generateStaffAttendanceQr":
      return { ok: true, ...(await generateStaffAttendanceQrCore(user)) };
    case "scanStaffAttendanceQr":
      return { ok: true, ...(await scanStaffAttendanceQrCore(user, body as never)) };
    case "correctStaffAttendance":
      await correctStaffAttendanceCore(user, body as never);
      break;
    case "saveStaffPayroll":
      await saveStaffPayrollCore(user, body as never);
      break;
    case "recordStaffSalaryPayment":
      return { ok: true, ...(await recordStaffSalaryPaymentCore(user, body as never)) };
    case "recordStaffSalaryPaymentsBulk":
      return { ok: true, ...(await recordStaffSalaryPaymentsBulkCore(user, body as never)) };
    case "voidStaffSalaryPayment":
      return { ok: true, ...(await voidStaffSalaryPaymentCore(user, body as never)) };
    case "createStaffMember":
      return { ok: true, ...(await createStaffMemberCore(user, body as never)) };
    case "setStaffOnboardingFile":
      await setStaffOnboardingFileCore(user, body as never);
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
    case "submitProfileRequest":
      return { ok: true, ...(await submitProfileRequestCore(user, body as never)) };
    case "reviewProfileRequest":
      return { ok: true, ...(await reviewProfileRequestCore(user, body as never)) };
    case "startInboxThread":
      return { ok: true, ...(await startInboxThreadCore(user, body as never)) };
    case "sendInboxMessage":
      await sendInboxMessageCore(user, body as never);
      break;
    case "updateInboxThread":
      await updateInboxThreadCore(user, body as never);
      break;
    case "replyParentQuery":
      await replyParentQueryCore(user, body as never);
      break;
    case "saveSchoolIdentity":
      await saveSchoolIdentityCore(user, body as never);
      break;
    case "checkSchoolWebsiteSlug":
      return { ok: true, ...(await checkSchoolWebsiteSlugCore(user, body as never)) };
    case "saveSchoolWebsite":
      return { ok: true, ...(await saveSchoolWebsiteCore(user, body as never)) };
    case "updateAdmissionLead":
      await updateAdmissionLeadCore(user, body as never);
      break;
    case "saveAdmissionForm":
      await saveAdmissionFormCore(user, body as never);
      break;
    case "saveStaffOnboardingForm":
      await saveStaffOnboardingFormCore(user, body as never);
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
    case "uploadStudentDocument":
      return { ok: true, ...(await uploadStudentDocumentCore(user, body)) };
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
    case "createExam":
      return { ok: true, ...(await createExamCore(user, body as never)) };
    case "updateExamItem":
      await updateExamItemCore(user, body as never);
      break;
    case "deleteExamItem":
      await deleteExamItemCore(user, body as never);
      break;
    case "addCbseExams":
      return { ok: true, ...(await addCbseExamsCore(user, body as never)) };
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
    case "setUnpaidLeave":
      return { ok: true, ...(await setUnpaidLeaveCore(user, body as never)) };
    case "applySchoolClock":
      return { ok: true, ...(await applySchoolClockCore(user, body as never)) };
    case "saveSchoolClock":
      await saveSchoolClockCore(user, body as never);
      break;
    case "setLeaveBalances": {
      const { setLeaveBalancesCore } = await import("./core-actions");
      return { ok: true, ...(await setLeaveBalancesCore(user, body as never)) };
    }
    case "adjustLeaveBalance": {
      const { adjustLeaveBalanceCore } = await import("./core-actions");
      await adjustLeaveBalanceCore(user, body as never);
      break;
    }
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
    case "loadTimetableRules": {
      const { loadTimetableRules } = await import("./timetable-autofill");
      return { ok: true, ...(await loadTimetableRules(user)) };
    }
    case "saveTimetableRules": {
      const { saveTimetableRules } = await import("./timetable-autofill");
      return await saveTimetableRules(user, body as never);
    }
    case "previewTimetableFill": {
      const { previewTimetableFill } = await import("./timetable-autofill");
      return { ok: true, ...(await previewTimetableFill(user)) };
    }
    case "applyTimetableFill": {
      const { applyTimetableFill } = await import("./timetable-autofill");
      return await applyTimetableFill(user, body as never);
    }
    case "countTimetableClear": {
      const { countTimetableClear } = await import("./timetable-autofill");
      return { ok: true, ...(await countTimetableClear(user, body as never)) };
    }
    case "clearTimetable": {
      const { clearTimetable } = await import("./timetable-autofill");
      return await clearTimetable(user, body as never);
    }
    case "restoreTimetable": {
      const { restoreTimetable } = await import("./timetable-autofill");
      return await restoreTimetable(user, body as never);
    }
    case "undoTimetableFill": {
      const { undoTimetableFill } = await import("./timetable-autofill");
      return await undoTimetableFill(user, body as never);
    }
    case "loadDayTimetable": {
      const { loadDayTimetable } = await import("./timetable-day");
      return { ok: true, ...(await loadDayTimetable(user, body as never)) };
    }
    case "saveDayChange": {
      const { saveDayChange } = await import("./timetable-day");
      return await saveDayChange(user, body as never);
    }
    case "clearDayChange": {
      const { clearDayChange } = await import("./timetable-day");
      return await clearDayChange(user, body as never);
    }
    case "markTeacherOut": {
      const { markTeacherOut } = await import("./timetable-day");
      return await markTeacherOut(user, body as never);
    }
    case "clearTeacherOut": {
      const { clearTeacherOut } = await import("./timetable-day");
      return await clearTeacherOut(user, body as never);
    }
    case "autoCoverDay": {
      const { autoCoverDay } = await import("./timetable-day");
      return await autoCoverDay(user, body as never);
    }
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
      return { ok: true, ...(await issueClassFeesCore(user, body as never)) };
    case "createInvoice":
      await createInvoiceCore(user, body as never);
      break;
    case "saveFeeTemplate":
      return { ok: true, ...(await saveFeeTemplateCore(user, body as never)) };
    case "saveFeeCatalog":
      return { ok: true, ...(await saveFeeCatalogCore(user, body as never)) };
    case "applySessionLateFee":
      return { ok: true, ...(await applySessionLateFeeCore(user, body as never)) };
    case "saveFeeAcademicSession":
      return { ok: true, ...(await saveFeeAcademicSessionCore(user, body as never)) };
    case "applySessionDueDay":
      return { ok: true, ...(await applySessionDueDayCore(user, body as never)) };
    case "assignStudentFees":
      await assignStudentFeesCore(user, body as never);
      break;
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
    case "reassignExamTeacher":
      await reassignExamTeacherCore(user, body as never);
      break;
    case "updateExamSeriesPapers":
      await updateExamSeriesPapersCore(user, body as never);
      break;
    case "handOverExamPaper":
      await handOverExamPaperCore(user, body as never);
      break;
    case "undoExamPaperHandover":
      await undoExamPaperHandoverCore(user, body as never);
      break;
    case "receiveExamPaper":
      await receiveExamPaperCore(user, body as never);
      break;
    case "returnExamPaper":
      await returnExamPaperCore(user, body as never);
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
    case "pastExamMarks":
      return { ok: true, ...(await pastExamMarksCore(user, body as never)) };
    case "readPastExamSheet":
      return { ok: true, ...(await readPastExamSheetCore(user, body as never)) };
    case "editPublishedMarks":
      return { ok: true, ...(await editPublishedMarksCore(user, body as never)) };
    case "setStaffTeaching":
      return { ok: true, ...(await setStaffTeachingCore(user, body as never)) };
    case "reassignExamRole":
      return { ok: true, ...(await reassignExamRoleCore(user, body as never)) };
    case "scheduleExamForClasses":
      return { ok: true, ...(await scheduleExamForClassesCore(user, body as never)) };
    case "savePastExamMarks":
      return { ok: true, ...(await savePastExamMarksCore(user, body as never)) };
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
    case "getMyAccount":
      return { ok: true, account: await getMyAccountCore(user) };
    case "updateMyName":
      return { ok: true, ...(await updateMyNameCore(user, body as never)) };
    case "requestContactChange":
      return { ...(await requestMyContactChangeCore(user, body as never)) };
    case "confirmContactChange":
      return { ...(await confirmMyContactChangeCore(user, body as never)) };
    case "prepareNextYear":
      return { ok: true, ...(await prepareNextYearCore(user, body as never)) };
    case "promotionBoard":
      return { ok: true, ...(await promotionBoardCore(user)) };
    case "savePromotionDecisions":
      return { ok: true, ...(await savePromotionDecisionsCore(user, body as never)) };
    case "resetPromotionClass":
      await resetPromotionClassCore(user, body as never);
      break;
    case "switchToNextYear":
      return { ok: true, ...(await switchToNextYearCore(user, body as never)) };
    case "undoYearSwitch":
      return { ok: true, ...(await undoYearSwitchCore(user)) };
    case "schoolYearSummary":
      return { ok: true, ...(await schoolYearSummaryCore(user, body as never)) };
    case "pastStudents":
      return { ok: true, ...(await pastStudentsCore(user, body as never)) };
    case "markStudentLeft":
      return { ok: true, ...(await markStudentLeftCore(user, body as never)) };
    case "restoreStudent":
      return { ok: true, ...(await restoreStudentCore(user, body as never)) };
    case "adminSetPassword":
      return { ok: true, ...(await adminSetPasswordCore(user, body as never)) };
    case "changePassword":
      await changeOwnPasswordCore(user, {
        current: String(body.current || ""),
        next: String(body.next || ""),
      });
      break;
    case "saveWebsiteForm":
      await saveWebsiteFormCore(user, body as never);
      break;
    case "setStudentAdmissionFile":
      await setStudentAdmissionFileCore(user, body as never);
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
        combineFamily: body.combineFamily === true,
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
