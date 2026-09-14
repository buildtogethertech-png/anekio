import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");
const outDir = "/private/tmp/anekio-prisma-erd";
const htmlPath = path.join(outDir, "anekio-prisma-erd.html");

fs.mkdirSync(outDir, { recursive: true });

const schema = fs.readFileSync(schemaPath, "utf8");
const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
const models = [];
const modelNames = new Set();

let match;
while ((match = modelRegex.exec(schema))) modelNames.add(match[1]);
modelRegex.lastIndex = 0;

function baseType(raw) {
  return raw.replace(/[\[\]?]/g, "");
}

function safeIdent(value, fallback = "field") {
  let out = String(value || fallback).replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(out)) out = `_${out}`;
  if (["from", "to", "date", "class", "type", "default", "string", "int", "float", "boolean"].includes(out.toLowerCase())) {
    out = `${out}_field`;
  }
  return out;
}

function safeType(raw) {
  const type = baseType(raw);
  if (["String", "DateTime", "Json", "Bytes"].includes(type)) return "string";
  if (["Int", "BigInt"].includes(type)) return "int";
  if (["Float", "Decimal"].includes(type)) return "float";
  if (type === "Boolean") return "boolean";
  return "string";
}

function parseField(line) {
  const clean = line.trim();
  if (!clean || clean.startsWith("//") || clean.startsWith("@@")) return null;
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return null;
  const name = parts[0];
  const rawType = parts[1];
  const type = baseType(rawType);
  const attrs = clean.slice(`${name} ${rawType}`.length).trim();
  return {
    name,
    rawType,
    type,
    attrs,
    isRelation: modelNames.has(type),
    isList: rawType.endsWith("[]"),
    isOptional: rawType.endsWith("?"),
    isId: /\s@id\b/.test(` ${attrs}`),
    isUnique: /\s@unique\b/.test(` ${attrs}`),
  };
}

while ((match = modelRegex.exec(schema))) {
  models.push({
    name: match[1],
    fields: match[2].split("\n").map(parseField).filter(Boolean),
  });
}

const domains = [
  { id: "core", title: "Core / Auth / SaaS", patterns: [/^User$/, /^Role$/, /^Permission$/, /^SaasOrg$/, /^SchoolConfig$/, /^SchoolSession$/, /^AuditLog$/, /^RoleGrant$/, /^AuthChallenge$/] },
  { id: "students", title: "Students / Parents / Classes", patterns: [/Student/, /^Parent$/, /^Class$/, /^Subject$/, /^Timetable/, /^Attendance$/, /^LeaveRequest$/] },
  { id: "fees", title: "Fees / Invoices / Payments", patterns: [/Fee/, /Invoice/, /Payment/, /Razorpay/, /Cashfree/, /Receipt/] },
  { id: "exams", title: "Exams / Marks / Reports", patterns: [/Exam/, /Series/, /Result/, /Mark/, /Paper/, /Contest/, /Grant/] },
  { id: "documents", title: "Documents / Templates", patterns: [/Document/, /Template/, /Upload/, /Issued/] },
  { id: "staff", title: "Staff / Teachers / Payroll", patterns: [/Teacher/, /Staff/, /Leave/, /Payroll/, /Salary/, /Skill/] },
  { id: "admissions", title: "Admissions / Notices / Communication", patterns: [/Admission/, /Application/, /Notice/, /Inbox/, /Lead/, /Message/] },
];

function inDomain(model, domain) {
  return domain.patterns.some((pattern) => pattern.test(model.name));
}

function fieldLine(field) {
  const flags = [field.isId ? "PK" : "", field.isUnique ? "UK" : ""].filter(Boolean).join(",");
  return `    ${safeType(field.rawType)} ${safeIdent(field.name)}${flags ? ` ${flags}` : ""}`;
}

function relationLines(selected) {
  const selectedNames = new Set(selected.map((model) => model.name));
  const lines = [];
  const seen = new Set();
  for (const model of selected) {
    for (const field of model.fields.filter((row) => row.isRelation)) {
      if (!selectedNames.has(field.type)) continue;
      const parent = field.isList ? model.name : field.type;
      const child = field.isList ? field.type : model.name;
      const connector = field.isOptional ? "||--o|" : "||--o{";
      const key = [parent, child, field.name].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${safeIdent(parent)} ${connector} ${safeIdent(child)} : ${safeIdent(field.name)}`);
    }
  }
  return lines;
}

function mermaidFor(domain) {
  const selected = models.filter((model) => inDomain(model, domain));
  const entityBlocks = selected.map((model) => {
    const scalar = model.fields.filter((field) => !field.isRelation).slice(0, 12);
    return `  ${safeIdent(model.name)} {\n${scalar.map(fieldLine).join("\n")}\n  }`;
  });
  return ["erDiagram", ...entityBlocks, ...relationLines(selected)].join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
}

const domainData = domains.map((domain) => ({
  ...domain,
  mermaid: mermaidFor(domain),
  count: models.filter((model) => inDomain(model, domain)).length,
}));

for (const domain of domainData) {
  fs.writeFileSync(path.join(outDir, `${domain.id}.mmd`), domain.mermaid);
}

const tabs = domainData.map((domain, index) => (
  `<button class="tab ${index === 0 ? "active" : ""}" data-tab="${domain.id}">${domain.title}<small>${domain.count}</small></button>`
)).join("");
const panes = domainData.map((domain, index) => (
  `<section class="pane ${index === 0 ? "active" : ""}" id="${domain.id}"><div class="paneHead"><h2>${domain.title}</h2><a download="${domain.id}.mmd" href="data:text/plain;charset=utf-8,${encodeURIComponent(domain.mermaid)}">Download Mermaid</a></div><div class="diagram"><pre class="mermaid">${escapeHtml(domain.mermaid)}</pre></div></section>`
)).join("");
const modelIndex = models.map((model) => `<li><b>${model.name}</b> <span>${model.fields.length} fields</span></li>`).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anekio Prisma ERD</title><style>
body{margin:0;background:#f5f7fb;color:#10233f;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{padding:24px 28px;background:white;border-bottom:1px solid #d7e0ee}h1{margin:0;font-size:28px}p{margin:8px 0 0;color:#64748b}.layout{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 94px)}aside{border-right:1px solid #d7e0ee;background:white;padding:18px;overflow:auto}.tab{width:100%;display:flex;justify-content:space-between;align-items:center;margin:0 0 8px;padding:12px;border:1px solid #d7e0ee;background:#fff;border-radius:8px;color:#10233f;font-weight:750;text-align:left;cursor:pointer}.tab.active{background:#2563eb;color:#fff;border-color:#2563eb}.tab small{opacity:.75}.models{margin-top:18px;border-top:1px solid #d7e0ee;padding-top:14px}.models h3{font-size:13px;text-transform:uppercase;color:#64748b}.models ul{list-style:none;margin:0;padding:0;max-height:320px;overflow:auto}.models li{font-size:12px;padding:5px 0;border-bottom:1px solid #eef2f7}.models span{color:#64748b}main{padding:22px;overflow:auto}.pane{display:none}.pane.active{display:block}.paneHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.paneHead h2{margin:0}.paneHead a{border:1px solid #d7e0ee;background:white;border-radius:8px;padding:9px 12px;color:#10233f;text-decoration:none;font-weight:700}.diagram{background:white;border:1px solid #d7e0ee;border-radius:12px;padding:18px;min-height:640px;overflow:auto;box-shadow:0 16px 40px rgba(16,35,63,.08)}.note{margin-bottom:16px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#7c2d12}@media(max-width:900px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #d7e0ee}.diagram{min-height:420px}}</style></head><body><header><h1>Anekio Prisma ERD</h1><p>Open-source Mermaid ER diagrams generated from <code>prisma/schema.prisma</code>, split by domain so it is readable.</p></header><div class="layout"><aside>${tabs}<div class="models"><h3>All ${models.length} models</h3><ul>${modelIndex}</ul></div></aside><main><div class="note">Tip: use the left tabs. This version sanitizes Prisma names/types for Mermaid, so reserved field names like from/to will not break rendering.</div>${panes}</main></div><script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs'; mermaid.initialize({startOnLoad:false,theme:'base',securityLevel:'loose',themeVariables:{primaryColor:'#ffffff',primaryBorderColor:'#94a3b8',primaryTextColor:'#10233f',lineColor:'#b45309',tertiaryColor:'#eef6ff'}}); async function renderActive(){const pane=document.querySelector('.pane.active'); const el=pane?.querySelector('.mermaid'); if(el && !el.dataset.processed){await mermaid.run({nodes:[el]});}} document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',async()=>{document.querySelectorAll('.tab,.pane').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active');await renderActive();})); renderActive();</script></body></html>`;

fs.writeFileSync(htmlPath, html);
console.log(htmlPath);
for (const domain of domainData) console.log(`${domain.id}: ${domain.count} models`);
