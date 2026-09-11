import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { publicOrigin } from "./utils";
import { admissionFormFields, admissionLeadInput, type AdmissionFormField } from "./admission-form";
import { normalizeSchoolWebsiteSlug } from "./host-routing";
import {
  createUploadPath,
  deleteUpload,
  presignedUploadUrl,
  safePathSegment,
  saveUpload,
  uploadMetadata,
  uploadContentType,
  uploadSchoolKey,
} from "./uploads";
import { usesS3Uploads } from "./s3-client";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}

function list(json: string | null | undefined, fallback: string[]) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 12) : fallback;
  } catch {
    return fallback;
  }
}

function asset(rel?: string | null) {
  return rel ? `${publicOrigin()}/api/files/${String(rel).replace(/^\/+/, "")}` : "";
}

async function findSchoolWebsiteConfig(slug?: string) {
  const rawSlug = String(slug || "").trim();
  if (rawSlug) {
    const websiteSlug = normalizeSchoolWebsiteSlug(rawSlug);
    if (!websiteSlug) return null;
    return prisma.schoolConfig.findUnique({ where: { websiteSlug } });
  }
  return prisma.schoolConfig.findUnique({ where: { id: "school" } });
}

const themes: Record<string, { main: string; soft: string; accent: string; dark: string }> = {
  blue: { main: "#2457e6", soft: "#eaf1ff", accent: "#ffb020", dark: "#07183f" },
  green: { main: "#07946f", soft: "#e7fff5", accent: "#ffb020", dark: "#062f28" },
  purple: { main: "#7c3aed", soft: "#f1ecff", accent: "#ffb020", dark: "#24104f" },
  orange: { main: "#f97316", soft: "#fff1e8", accent: "#2457e6", dark: "#431407" },
};

function admissionFieldHtml(field: AdmissionFormField) {
  const required = field.required ? " required" : "";
  const marker = field.required ? " *" : "";
  const label = `<label>${esc(field.label)}${marker}</label>`;
  const help = field.helpText ? `<span class="field-help">${esc(field.helpText)}</span>` : "";
  if (field.type === "textarea") {
    return `<div class="field full">${label}<textarea name="${esc(field.id)}"${required}></textarea>${help}</div>`;
  }
  if (field.type === "select") {
    return `<div class="field">${label}<select name="${esc(field.id)}"${required}><option value="">Select</option>${field.options.map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>${help}</div>`;
  }
  if (field.type === "radio" || field.type === "multi") {
    const type = field.type === "radio" ? "radio" : "checkbox";
    return `<div class="field full">${label}<div class="option-stack">${field.options.map((option) => `<label class="option-row"><input name="${esc(field.id)}" type="${type}" value="${esc(option)}"${required}> <span>${esc(option)}</span></label>`).join("")}</div>${help}</div>`;
  }
  if (field.type === "checkbox") {
    return `<div class="field full"><label class="option-row single"><input name="${esc(field.id)}" type="checkbox" value="Yes"${required}> <span>${esc(field.label)}${marker}</span></label>${help}</div>`;
  }
  if (field.type === "file") {
    const accept = field.fileType === "image" ? "image/png,image/jpeg" : field.fileType === "pdf" ? "application/pdf" : "image/png,image/jpeg,application/pdf";
    const formats = field.fileType === "image" ? "JPG or PNG" : field.fileType === "pdf" ? "PDF" : "JPG, PNG, or PDF";
    const max = field.maxFileSizeMb || 5;
    return `<div class="field full">${label}<label class="upload-box"><input name="${esc(field.id)}" data-upload-field="${esc(field.id)}" type="file" accept="${accept}"${required}><strong>Upload ${esc(field.label)}</strong><span>${formats} · up to ${max} MB</span></label>${help}</div>`;
  }
  const type = field.type === "phone" ? "tel" : field.type;
  return `<div class="field">${label}<input name="${esc(field.id)}" type="${type}"${required}>${help}</div>`;
}

export async function schoolWebsiteHtml(slug?: string, opts: { preview?: boolean } = {}) {
  const school = await findSchoolWebsiteConfig(slug);
  if (!school || (!school.websiteEnabled && !opts.preview)) return null;

  const theme = themes[school.websiteTheme] || themes.blue;
  const highlights = list(school.websiteHighlights, ["Admissions open", "Smart parent updates", "Safe campus"]);
  const facilities = list(school.websiteFacilities, ["Digital classrooms", "Library", "Computer lab", "Sports"]);
  const gallery = list(school.websiteGallery, []);
  const title = school.websiteHeroTitle || `${school.name} admissions are open`;
  const subtitle = school.websiteHeroSubtitle || "Enquire for admissions, campus visits, fees, and entrance test details.";
  const place = [school.address, school.city, school.state, school.pincode].filter(Boolean).join(", ");
  const logo = asset(school.logoPath);
  const admissionFields = admissionFormFields(school.admissionFormJson).filter((field) => field.visible);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(school.name)} · Admissions</title>
  <style>
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f7f9fc;color:#102033;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.wrap{max-width:1180px;margin:0 auto;padding:0 24px}.top{position:sticky;top:0;z-index:10;background:#ffffffdf;backdrop-filter:blur(18px);border-bottom:1px solid #e6edf5}.nav{height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:12px}.logo{width:52px;height:52px;border-radius:16px;background:white;object-fit:contain;padding:6px;border:1px solid #dbe5f1;box-shadow:0 10px 25px #0f172a12}.brand strong{font-size:18px}.brand span{font-size:13px;color:#607086}.links{display:flex;align-items:center;gap:22px}.links a{color:#30435c;text-decoration:none;font-weight:800;font-size:14px}.cta{display:inline-flex;align-items:center;justify-content:center;background:${theme.accent};color:#111827;text-decoration:none;font-weight:950;border-radius:999px;padding:13px 20px;box-shadow:0 12px 28px ${theme.accent}55}.hero{position:relative;overflow:hidden;background:radial-gradient(circle at 78% 8%,${theme.accent}33 0 130px,transparent 132px),linear-gradient(135deg,${theme.main},${theme.dark});color:white}.hero:before{content:"";position:absolute;inset:auto -160px -190px auto;width:520px;height:520px;border-radius:50%;background:#ffffff12}.hero-grid{position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:42px;align-items:center;min-height:680px;padding:72px 0}.kicker{display:inline-flex;align-items:center;gap:8px;background:#ffffff1f;border:1px solid #ffffff36;border-radius:999px;padding:9px 14px;font-size:13px;font-weight:950}.dot{width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 6px #22c55e24}.hero h1{font-size:64px;line-height:.98;margin:18px 0;letter-spacing:-2px;max-width:680px}.hero p{font-size:20px;line-height:1.65;color:#eaf2ff;max-width:640px}.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.chip{display:inline-flex;background:#fff;box-shadow:0 10px 22px #07183f22;color:${theme.main};border-radius:999px;padding:10px 14px;font-weight:950}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:34px;max-width:620px}.stat{border:1px solid #ffffff24;background:#ffffff14;border-radius:20px;padding:18px}.stat b{display:block;font-size:28px}.stat span{font-size:12px;color:#dbeafe;font-weight:900;text-transform:uppercase;letter-spacing:.06em}.hero-card{position:relative}.photo-card{border-radius:34px;background:linear-gradient(145deg,#fff,#edf5ff);padding:18px;box-shadow:0 30px 80px #07183f55;transform:rotate(1.5deg)}.scene{height:360px;border-radius:26px;background:linear-gradient(135deg,${theme.soft},#fff);position:relative;overflow:hidden;color:#102033}.sun{position:absolute;right:28px;top:28px;width:82px;height:82px;border-radius:50%;background:${theme.accent};box-shadow:0 0 0 18px ${theme.accent}22}.building{position:absolute;left:42px;bottom:0;width:265px;height:190px;background:white;border-radius:18px 18px 0 0;border:1px solid #d9e2ec}.roof{position:absolute;left:26px;bottom:185px;width:300px;height:55px;background:${theme.main};clip-path:polygon(50% 0,100% 100%,0 100%)}.window{position:absolute;width:42px;height:34px;border-radius:10px;background:${theme.soft};border:1px solid #cbd7e6}.w1{left:28px;top:48px}.w2{left:112px;top:48px}.w3{left:196px;top:48px}.door{position:absolute;left:105px;bottom:0;width:54px;height:80px;border-radius:16px 16px 0 0;background:${theme.main}}.children{position:absolute;right:32px;bottom:26px;background:#102033;color:white;border-radius:22px;padding:16px 18px;box-shadow:0 18px 36px #10203324}.children b{font-size:28px}.float{position:absolute;left:-8px;bottom:-24px;background:#fff;border-radius:22px;padding:18px 20px;box-shadow:0 24px 60px #07183f40;color:#102033}.float strong{display:block}.section{padding:72px 0}.section-title{max-width:760px}.eyebrow{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${theme.main};font-weight:950}.section h2{font-size:38px;letter-spacing:-.8px;line-height:1.1;margin:8px 0 12px}.muted{color:#607086;line-height:1.7}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:24px}.card{background:white;border:1px solid #e1e9f3;border-radius:24px;padding:24px;box-shadow:0 12px 34px #1020330a}.icon{width:44px;height:44px;border-radius:16px;background:${theme.soft};display:grid;place-items:center;font-size:22px;margin-bottom:16px}.card strong{display:block;font-size:19px;margin-bottom:8px}.about-grid{display:grid;grid-template-columns:1fr .9fr;gap:30px;align-items:start}.platform{background:#081525;color:white;position:relative;overflow:hidden}.platform:before{content:"";position:absolute;right:-120px;top:-120px;width:360px;height:360px;border-radius:50%;background:${theme.main};opacity:.28}.platform-grid{position:relative;display:grid;grid-template-columns:.9fr 1.1fr;gap:32px;align-items:center}.phone-stack{background:linear-gradient(145deg,#17233a,#0b1324);border:1px solid #334155;border-radius:34px;padding:22px;box-shadow:0 34px 90px #0005}.app-card{background:white;color:#102033;border-radius:22px;padding:18px;margin:12px 0;display:flex;gap:14px;align-items:center}.app-icon{width:44px;height:44px;border-radius:15px;background:${theme.soft};display:grid;place-items:center;font-size:22px;flex:0 0 auto}.feature-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.feature{background:#ffffff10;border:1px solid #ffffff1f;border-radius:20px;padding:18px}.feature b{display:block;color:white}.feature span{display:block;margin-top:6px;color:#cbd5e1;font-size:14px;line-height:1.5}.facility-box{background:${theme.dark};color:white;border-radius:30px;padding:30px;box-shadow:0 24px 70px #10203322}.facility-list{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.facility{background:#ffffff14;border:1px solid #ffffff22;border-radius:16px;padding:14px;font-weight:850}.admission-band{background:linear-gradient(135deg,${theme.soft},#fff);border-top:1px solid #e1e9f3;border-bottom:1px solid #e1e9f3}.admission-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:28px;align-items:start}.steps{display:grid;gap:14px;margin-top:22px}.step{display:flex;gap:12px;align-items:flex-start}.num{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:${theme.main};color:white;font-weight:950;flex:0 0 auto}.panel{background:white;color:#102033;border:1px solid #e1e9f3;border-radius:30px;padding:28px;box-shadow:0 28px 80px #10203318}.panel h2{font-size:30px;margin:0 0 6px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:flex;flex-direction:column;gap:7px;margin-top:14px}.field.full{grid-column:1/-1}.field label{font-size:11px;font-weight:950;color:#607086;text-transform:uppercase;letter-spacing:.05em}.field input,.field textarea,.field select{border:1px solid #cbd7e6;border-radius:15px;padding:14px 15px;font:inherit;background:#fbfdff;outline:none}.field input:focus,.field textarea:focus,.field select:focus{border-color:${theme.main};box-shadow:0 0 0 4px ${theme.soft}}.field textarea{min-height:92px;resize:vertical}.field-help{font-size:12px;color:#607086}.option-stack{display:grid;gap:8px;border:1px solid #e1e9f3;border-radius:15px;background:#fbfdff;padding:12px}.option-row{display:flex!important;align-items:center;gap:8px;text-transform:none!important;letter-spacing:0!important;color:#102033!important;font-size:14px!important;font-weight:750!important}.option-row input{width:16px;height:16px}.option-row.single{border:1px solid #e1e9f3;border-radius:15px;background:#fbfdff;padding:12px}.upload-box{display:flex!important;flex-direction:column;gap:4px;border:1px dashed #9db2cf;border-radius:15px;background:#fbfdff;padding:16px;text-transform:none!important;letter-spacing:0!important;color:#102033!important}.upload-box input{padding:0;border:0;background:transparent}.upload-box span{color:#607086;font-size:12px}.submit{width:100%;margin-top:18px;border:0;border-radius:16px;background:${theme.main};color:white;font-weight:950;padding:16px;font-size:16px;box-shadow:0 16px 32px ${theme.main}30}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.gallery img{width:100%;height:190px;object-fit:cover;border-radius:24px;box-shadow:0 18px 38px #10203316}.contact{background:white;border-radius:30px;padding:30px;border:1px solid #e1e9f3;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px}.footer{padding:34px 0;background:#07111f;color:#dbeafe}.footer .wrap{display:flex;align-items:center;justify-content:space-between;gap:18px}.small{font-size:13px;color:#a9b8cc}@media(max-width:900px){.links{display:none}.hero-grid,.about-grid,.platform-grid,.admission-grid,.contact{grid-template-columns:1fr}.hero-grid{min-height:auto;padding:46px 0}.hero h1{font-size:42px}.form-grid,.cards,.facility-list,.stats,.gallery,.feature-grid{grid-template-columns:1fr}.footer .wrap{align-items:flex-start;flex-direction:column}.photo-card{transform:none}.scene{height:280px}}
  </style>
</head>
<body>
  <div class="top"><div class="wrap"><nav class="nav">
    <div class="brand">${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : `<div class="logo"></div>`}<div><strong>${esc(school.name)}</strong><br><span>${esc(school.affiliation || "Admissions open")}</span></div></div>
    <div class="links"><a href="#about">About</a><a href="#platform">Parent app</a><a href="#facilities">Facilities</a><a href="#admission">Admissions</a><a href="#contact">Contact</a><a class="cta" href="#admission">Enquire now</a></div>
  </nav></div></div>
  <header class="hero"><div class="wrap hero-grid">
    <div>
      <span class="kicker"><i class="dot"></i>${school.websiteAdmissionOpen ? "Admissions open for 2026–27" : "Admission enquiries open"}</span>
      <h1>${esc(title)}</h1>
      <p>${esc(subtitle)}</p>
      <div class="chips">${highlights.map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</div>
      <div class="stats"><div class="stat"><b>1:1</b><span>parent follow-up</span></div><div class="stat"><b>100%</b><span>digital updates</span></div><div class="stat"><b>24h</b><span>office callback</span></div></div>
    </div>
    <div class="hero-card"><div class="photo-card"><div class="scene"><div class="sun"></div><div class="roof"></div><div class="building"><div class="window w1"></div><div class="window w2"></div><div class="window w3"></div><div class="door"></div></div><div class="children"><b>Admissions</b><br><span>Campus visit · Fees · Entrance test</span></div></div></div><div class="float"><strong>Enquiry goes directly to school office</strong><span class="small">No missed WhatsApp screenshots.</span></div></div>
  </div></header>
  <main>
    <section id="about" class="section"><div class="wrap about-grid">
      <div class="section-title"><span class="eyebrow">About the school</span><h2>A warm campus, structured academics, and clear parent communication.</h2><p class="muted">${esc(school.websiteAbout || "We help every child learn with care, structure, regular parent communication, and a safe school environment.")}</p></div>
      <div class="cards" style="grid-template-columns:1fr"><div class="card"><div class="icon">🎓</div><strong>Academic focus</strong><span class="muted">Clear learning plans, exams, and progress updates for every child.</span></div><div class="card"><div class="icon">🛡️</div><strong>Safe daily routines</strong><span class="muted">Attendance, notices, and school operations stay organised.</span></div></div>
    </div></section>
    <section id="platform" class="section platform"><div class="wrap platform-grid">
      <div><span class="eyebrow" style="color:${theme.accent}">Powered by Anekio</span><h2 style="color:white">Your child follows a world-class digital school system.</h2><p style="color:#cbd5e1;line-height:1.8">This school uses Anekio to keep attendance, marks, fees, notices, documents, admissions and parent communication organised in one place. Parents do not have to chase scattered messages — important updates stay structured and easy to follow.</p></div>
      <div class="phone-stack">
        <div class="app-card"><span class="app-icon">✅</span><div><strong>Daily attendance</strong><br><span class="muted">Present, absent and late updates are tracked clearly.</span></div></div>
        <div class="app-card"><span class="app-icon">📊</span><div><strong>Marks & report cards</strong><br><span class="muted">Exam progress, results and documents stay connected.</span></div></div>
        <div class="app-card"><span class="app-icon">💳</span><div><strong>Fees, receipts & reminders</strong><br><span class="muted">Bills, payments and receipts are easier for parents.</span></div></div>
      </div>
      <div class="feature-grid" style="grid-column:1/-1">
        <div class="feature"><b>Attendance</b><span>Daily presence, late marks and parent visibility.</span></div>
        <div class="feature"><b>Exams & marks</b><span>Date sheets, marks entry, results and report cards.</span></div>
        <div class="feature"><b>Fees</b><span>Invoices, receipts, online links and follow-ups.</span></div>
        <div class="feature"><b>Documents</b><span>ID cards, admit cards, certificates and verification QR.</span></div>
      </div>
    </div></section>
    <section id="facilities" class="section"><div class="wrap facility-box"><span class="eyebrow" style="color:${theme.accent}">Campus facilities</span><h2 style="color:white">Everything parents want to understand before admission.</h2><div class="facility-list">${facilities.map((f) => `<div class="facility">${esc(f)}</div>`).join("")}</div></div></section>
    ${gallery.length ? `<section class="section"><div class="wrap"><div class="section-title"><span class="eyebrow">Campus gallery</span><h2>See the campus before you visit.</h2></div><div class="gallery">${gallery.map((g) => `<img src="${esc(asset(g))}" alt="">`).join("")}</div></div></section>` : ""}
    <section id="admission" class="section admission-band"><div class="wrap admission-grid"><div><span class="eyebrow">Admissions</span><h2>Submit an enquiry. The school office will follow up.</h2><p class="muted">${esc(school.websiteAdmissionNote || "Admissions are open. Submit an enquiry and our office will contact you.")}</p><div class="steps"><div class="step"><span class="num">1</span><div><strong>Send enquiry</strong><br><span class="muted">Tell us about the student and upload requested documents.</span></div></div><div class="step"><span class="num">2</span><div><strong>Office callback</strong><br><span class="muted">The admission team confirms fees, documents and visit slots.</span></div></div><div class="step"><span class="num">3</span><div><strong>Entrance test / admission</strong><br><span class="muted">If needed, the school schedules a test and completes admission.</span></div></div></div></div><form id="admission-form" class="panel" method="post" enctype="multipart/form-data" action="/school/${esc(school.websiteSlug)}/lead"><h2>Admission enquiry</h2><p class="muted">Fill this form and the school office will contact you.</p><div class="form-grid">${admissionFields.map(admissionFieldHtml).join("")}</div><button class="submit" type="submit">Send admission enquiry</button></form></div></section>
    <section id="contact" class="section"><div class="wrap"><div class="contact"><div><span class="eyebrow">Phone</span><h3>${esc(school.phone || "School office")}</h3></div><div><span class="eyebrow">Email</span><h3>${esc(school.email || "Contact school")}</h3></div><div><span class="eyebrow">Address</span><h3>${esc(place || "Campus address")}</h3></div></div></div></section>
  </main>
  <footer class="footer"><div class="wrap"><div><strong>${esc(school.name)}</strong><div class="small">${esc(place)}</div></div><div class="small">Admissions website powered by Anekio</div></div></footer>
  <script>
    const admissionForm = document.getElementById("admission-form");
    admissionForm.addEventListener("submit", async (event) => {
      const inputs = Array.from(admissionForm.querySelectorAll("input[type=file][data-upload-field]")).filter((input) => input.files && input.files[0]);
      if (!inputs.length) return;
      event.preventDefault();
      const submit = admissionForm.querySelector("button[type=submit]");
      submit.disabled = true;
      submit.textContent = "Uploading documents...";
      try {
        for (const input of inputs) {
          const file = input.files[0];
          const preparedResponse = await fetch("/school/${esc(school.websiteSlug)}/upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldId: input.dataset.uploadField, fileName: file.name, fileType: file.type, fileSize: file.size }),
          });
          const prepared = await preparedResponse.json();
          if (!preparedResponse.ok) throw new Error(prepared.error || "Could not prepare document upload.");
          if (!prepared.direct) {
            HTMLFormElement.prototype.submit.call(admissionForm);
            return;
          }
          const uploaded = await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: file });
          if (!uploaded.ok) throw new Error("A document could not be uploaded.");
          const hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "uploadToken_" + input.dataset.uploadField;
          hidden.value = prepared.completionToken;
          admissionForm.appendChild(hidden);
          input.disabled = true;
        }
        HTMLFormElement.prototype.submit.call(admissionForm);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = "Send admission enquiry";
        alert(error instanceof Error ? error.message : "Documents could not be uploaded.");
      }
    });
  </script>
</body>
</html>`;
}

function fileAllowed(field: AdmissionFormField, file: { originalname: string; mimetype: string; size: number }) {
  const name = String(file.originalname || "").toLowerCase();
  const extension = name.match(/\.[a-z0-9]+$/)?.[0] || "";
  const genericMime = !file.mimetype || file.mimetype === "application/octet-stream";
  const isImage = (!extension || [".jpg", ".jpeg", ".png"].includes(extension))
    && (["image/jpeg", "image/png"].includes(file.mimetype) || (genericMime && /\.(jpe?g|png)$/.test(name)));
  const isPdf = (!extension || extension === ".pdf")
    && (file.mimetype === "application/pdf" || (genericMime && extension === ".pdf"));
  const accepts = field.fileType || "image_pdf";
  if (accepts === "image") return isImage;
  if (accepts === "pdf") return isPdf;
  return isImage || isPdf;
}

type AdmissionUploadIntent = {
  exp: number;
  fieldId: string;
  fileName: string;
  mime: string;
  path: string;
  size: number;
  slug: string;
};

function admissionUploadSecret() {
  const secret = process.env.APP_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("APP_JWT_SECRET or JWT_SECRET is required");
  return secret;
}

function signAdmissionUpload(intent: AdmissionUploadIntent) {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  const signature = createHmac("sha256", admissionUploadSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyAdmissionUpload(token: string, slug: string, field: AdmissionFormField) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) throw new Error("Admission upload is invalid.");
  const expected = createHmac("sha256", admissionUploadSecret()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Admission upload is invalid.");
  const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdmissionUploadIntent;
  if (intent.slug !== slug || intent.fieldId !== field.id || intent.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Admission upload expired.");
  }
  if (!intent.path.startsWith(`private/schools/${uploadSchoolKey()}/admissions/`)) throw new Error("Admission upload is invalid.");
  return intent;
}

export async function prepareAdmissionFileUpload(slug: string, input: Record<string, unknown>) {
  const school = await findSchoolWebsiteConfig(slug);
  if (!school?.websiteEnabled) throw new Error("Admissions website not found.");
  const fieldId = String(input.fieldId || "");
  const field = admissionFormFields(school.admissionFormJson).find((row) => row.visible && row.type === "file" && row.id === fieldId);
  if (!field) throw new Error("Admission document field not found.");
  const file = {
    originalname: String(input.fileName || ""),
    mimetype: String(input.fileType || "application/octet-stream"),
    size: Number(input.fileSize || 0),
  };
  if (!fileAllowed(field, file)) throw new Error(`Upload ${field.label} as an accepted file type.`);
  const maxBytes = (field.maxFileSizeMb || 5) * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) throw new Error(`${field.label} must be ${field.maxFileSizeMb || 5} MB or smaller.`);
  if (!usesS3Uploads()) return { direct: false as const };
  const folder = `private/schools/${uploadSchoolKey()}/admissions/${randomUUID()}/${safePathSegment(field.id)}`;
  const intent: AdmissionUploadIntent = {
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
    fieldId,
    fileName: file.originalname,
    mime: uploadContentType(file.originalname, file.mimetype),
    path: createUploadPath(folder, file.originalname),
    size: file.size,
    slug,
  };
  return {
    direct: true as const,
    uploadUrl: await presignedUploadUrl(intent.path, intent.mime),
    completionToken: signAdmissionUpload(intent),
    headers: { "Content-Type": intent.mime },
  };
}

export async function createAdmissionLeadFromWebsite(slug: string, input: Record<string, unknown>, files: Express.Multer.File[] = []) {
  const school = await findSchoolWebsiteConfig(slug);
  if (!school) throw new Error("Admissions website not found.");
  if (!school.websiteEnabled) throw new Error("Admissions website is not active.");
  const fields = admissionFormFields(school.admissionFormJson);
  const submissionId = randomUUID();
  for (const field of fields.filter((row) => row.visible && row.type === "file")) {
    const file = files.find((row) => row.fieldname === field.id);
    if (file) {
      if (!fileAllowed(field, file)) throw new Error(`Upload ${field.label} as an accepted file type.`);
      const maxBytes = (field.maxFileSizeMb || 5) * 1024 * 1024;
      if (file.size > maxBytes) throw new Error(`${field.label} must be ${field.maxFileSizeMb || 5} MB or smaller.`);
      const folder = `private/schools/${uploadSchoolKey()}/admissions/${submissionId}/${safePathSegment(field.id)}`;
      input[field.id] = await saveUpload(folder, file.originalname, file.buffer, file.mimetype);
      continue;
    }
    const token = String(input[`uploadToken_${field.id}`] || "");
    if (!token) continue;
    const intent = verifyAdmissionUpload(token, slug, field);
    const metadata = await uploadMetadata(intent.path);
    if (metadata.size !== intent.size || metadata.size <= 0) {
      await deleteUpload(intent.path);
      throw new Error(`${field.label} upload did not complete.`);
    }
    input[field.id] = intent.path;
  }
  const values = admissionLeadInput(school.admissionFormJson, input);
  const officeAuthor = await prisma.user.findFirst({
    where: { role: { portal: "OFFICE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return prisma.$transaction(async (tx) => {
    const lead = await tx.admissionLead.create({
      data: {
        studentName: values.studentName,
        guardianName: values.guardianName,
        phone: values.phone,
        email: values.email,
        classWanted: values.classWanted,
        message: values.message,
        customFieldsJson: JSON.stringify(values.customValues),
        events: {
          create: {
            kind: "NEW",
            title: "Website enquiry received",
            body: values.classWanted ? `Parent submitted enquiry for ${values.classWanted}.` : "Parent submitted an admission enquiry.",
            actorName: "School website",
          },
        },
      },
    });
    if (officeAuthor) {
      await tx.notice.create({
        data: {
          title: `New admission enquiry: ${lead.studentName || lead.guardianName || "Website lead"}`,
          body: `${lead.guardianName || "No guardian name"} · ${lead.phone || "No phone"} · ${lead.classWanted ? `Class ${lead.classWanted}` : "No class"}\n${lead.message || "No message"}\n\nlead:${lead.id}`,
          kind: "ADMISSION",
          priority: "ACTION",
          authorId: officeAuthor.id,
          audiences: { create: [{ portal: "OFFICE" }] },
        },
      });
    }
    return lead;
  });
}
