import type { AdmissionFormField } from "./record";

/**
 * Fields Indian schools commonly ask for, offered as one-tap "Quick add" in the form builder
 * (on top of Anekio's default form). Nothing here is added until the office picks it.
 * Order matters: the form builder shows the first 10 not yet on the form, the rest under "More".
 */
type Spec = Partial<AdmissionFormField> & { id: string; label: string };

function make(specs: Spec[]): AdmissionFormField[] {
  return specs.map((spec) => ({
    type: "text",
    required: false,
    visible: true,
    options: [],
    builtin: false,
    helpText: "",
    ...spec,
    ...(spec.type === "file" ? { fileType: spec.fileType || "image_pdf", maxFileSizeMb: spec.maxFileSizeMb || 5 } : {}),
  })) as AdmissionFormField[];
}

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const YES_NO = ["Yes", "No"];

export const COMMON_ADMISSION_FIELDS = make([
  { id: "gender", label: "Gender", type: "select", options: ["Boy", "Girl", "Other"] },
  { id: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS },
  { id: "category", label: "Category", type: "select", options: ["General", "OBC", "SC", "ST", "EWS"] },
  { id: "custom_aadhaar_number", label: "Aadhaar number", helpText: "12-digit Aadhaar of the student." },
  { id: "apaarId", label: "APAAR ID", helpText: "One Nation One Student ID, if the student has one." },
  { id: "custom_pen", label: "PEN (UDISE+)", helpText: "Permanent Education Number from the previous school." },
  { id: "custom_father_name", label: "Father's name" },
  { id: "custom_mother_name", label: "Mother's name" },
  { id: "custom_emergency_contact", label: "Emergency contact", type: "phone" },
  { id: "custom_transport", label: "School transport needed", type: "radio", options: YES_NO },
  { id: "custom_rte", label: "RTE admission", type: "radio", options: YES_NO },
  { id: "custom_father_mobile", label: "Father's mobile", type: "phone" },
  { id: "custom_mother_mobile", label: "Mother's mobile", type: "phone" },
  { id: "custom_religion", label: "Religion", type: "select", options: ["Hindu", "Muslim", "Christian", "Sikh", "Buddhist", "Jain", "Other"] },
  { id: "motherTongue", label: "Mother tongue" },
  { id: "custom_medical", label: "Medical conditions / allergies", type: "textarea" },
  { id: "homeAddress", label: "Home address", type: "textarea" },
  { id: "custom_previous_school", label: "Previous school" },
  { id: "custom_sibling_in_school", label: "Sibling in this school", helpText: "Name and class, if any." },
  { id: "custom_caste", label: "Caste" },
  { id: "custom_nationality", label: "Nationality", helpText: "e.g. Indian" },
  { id: "custom_place_of_birth", label: "Place of birth" },
  { id: "custom_father_occupation", label: "Father's occupation" },
  { id: "custom_mother_occupation", label: "Mother's occupation" },
  { id: "custom_family_income", label: "Annual family income", type: "select", options: ["Below ₹1 lakh", "₹1–3 lakh", "₹3–5 lakh", "₹5–10 lakh", "Above ₹10 lakh"] },
  { id: "custom_previous_class", label: "Last class passed" },
  { id: "custom_leaving_reason", label: "Reason for leaving previous school" },
  { id: "custom_pickup_point", label: "Pickup point" },
  { id: "custom_birth_certificate", label: "Birth certificate", type: "file" },
  { id: "studentPhoto", label: "Student photo", type: "file", fileType: "image", helpText: "Passport-size photo, plain background." },
  { id: "custom_aadhaar_card", label: "Aadhaar card", type: "file" },
  { id: "custom_transfer_certificate", label: "Transfer certificate", type: "file" },
  { id: "custom_previous_report_card", label: "Previous report card", type: "file" },
  { id: "custom_caste_certificate", label: "Caste certificate", type: "file" },
  { id: "custom_income_certificate", label: "Income certificate", type: "file" },
  { id: "custom_parent_id_proof", label: "Parent ID proof", type: "file" },
  { id: "custom_address_proof", label: "Address proof", type: "file" },
  { id: "custom_medical_certificate", label: "Medical certificate", type: "file" },
]);

export const COMMON_ENQUIRY_FIELDS = make([
  { id: "custom_child_dob", label: "Child's date of birth", type: "date" },
  { id: "custom_child_gender", label: "Child's gender", type: "select", options: ["Boy", "Girl", "Other"] },
  { id: "custom_current_school", label: "Current school" },
  { id: "custom_alternate_mobile", label: "Alternate mobile", type: "phone" },
  { id: "custom_area", label: "Area / locality" },
  { id: "custom_visit_date", label: "Preferred visit date", type: "date" },
  { id: "custom_call_time", label: "Best time to call", type: "select", options: ["Morning", "Afternoon", "Evening"] },
  { id: "custom_transport", label: "School transport needed", type: "radio", options: YES_NO },
  { id: "custom_sibling_in_school", label: "Sibling in this school", helpText: "Name and class, if any." },
  { id: "custom_hear_about", label: "How did you hear about us?", type: "select", options: ["Friends / family", "Google", "Facebook / Instagram", "Banner / hoarding", "Newspaper", "Other"] },
]);

export const COMMON_STAFF_FIELDS = make([
  { id: "dateOfBirth", label: "Date of birth", type: "date" },
  { id: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
  { id: "custom_qualification", label: "Highest qualification", type: "select", options: ["10th", "12th", "Diploma", "Graduate", "Post-graduate", "B.Ed", "M.Ed", "PhD"] },
  { id: "experienceYears", label: "Teaching experience (years)", type: "number" },
  { id: "emergencyPhone", label: "Emergency contact", type: "phone" },
  { id: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS },
  { id: "custom_aadhaar_number", label: "Aadhaar number" },
  { id: "panNumber", label: "PAN number" },
  { id: "custom_bank_account", label: "Bank account number" },
  { id: "custom_ifsc", label: "IFSC code" },
  { id: "maritalStatus", label: "Marital status", type: "select", options: ["Single", "Married", "Other"] },
  { id: "custom_father_spouse_name", label: "Father / spouse name" },
  { id: "custom_subjects", label: "Subjects taught" },
  { id: "custom_previous_employer", label: "Previous employer" },
  { id: "custom_joining_date", label: "Date of joining", type: "date" },
  { id: "custom_current_address", label: "Current address", type: "textarea" },
  { id: "custom_permanent_address", label: "Permanent address", type: "textarea" },
  { id: "custom_bank_name", label: "Bank name" },
  { id: "uan", label: "UAN / PF number" },
  { id: "esic", label: "ESIC number" },
  { id: "custom_staff_photo", label: "Photo", type: "file", fileType: "image" },
  { id: "custom_aadhaar_card", label: "Aadhaar card", type: "file" },
  { id: "custom_pan_card", label: "PAN card", type: "file" },
  { id: "custom_resume", label: "Resume / CV", type: "file" },
  { id: "custom_degree_certificates", label: "Degree certificates", type: "file" },
  { id: "custom_bed_certificate", label: "B.Ed certificate", type: "file" },
  { id: "custom_experience_letter", label: "Experience letter", type: "file" },
  { id: "custom_police_verification", label: "Police verification", type: "file" },
  { id: "custom_cancelled_cheque", label: "Cancelled cheque", type: "file" },
]);
