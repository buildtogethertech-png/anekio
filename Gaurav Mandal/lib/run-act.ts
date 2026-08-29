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
  sendClassNoteCore,
  submitParentQueryCore,
  saveSchoolClockCore,
  saveSchoolIdentityCore,
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
  collectAllStudentFeesCore,
  completeExamWorkCore,
  copyExamSeriesCore,
  createInvoiceCore,
  importExamMarksCore,
  importPeopleSheetCore,
  issueClassFeesCore,
  saveExamMarksCore,
  saveFeeTemplateCore,
  saveSeriesMarksCore,
  sendFeeRemindersCore,
  startNextSchoolSessionCore,
  updateExamSeriesPapersCore,
  uploadPaperCore,
  uploadQuestionPaperCore,
} from "./core-office";
import { savePushTokenCore } from "./push";
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

export async function runAct(
  user: AccessUser,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const op = String(body.op || "");
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
      await markStaffAttendanceCore(user, body as never);
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
      await addPeriodCore(user, body as never);
      break;
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
      await saveFeeTemplateCore(user, body as never);
      break;
    case "sendFeeReminders":
      return { ok: true, ...(await sendFeeRemindersCore(user, body as never)) };
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
    case "importPeopleSheet":
      return { ok: true, ...(await importPeopleSheetCore(user, body as never)) };
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
      throw Object.assign(new Error("Unknown action"), { status: 400 });
  }
  return { ok: true };
}
