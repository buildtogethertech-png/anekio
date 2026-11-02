/**
 * Anekio marketing page — presentation layer (nav, hero, product story, closeout, footer).
 * The "Get started" section (#start: demo / pay journeys) lives in anekio-site.ts; it is restyled here via CSS only.
 * Screens come from real product screenshots in public/demo/shots.
 *
 * Design system (keep it strict):
 *  - One typeface (Geist), weights 400/500/600 only.
 *  - Three button kinds, all pill-shaped and the same height: primary (solid brand), secondary (hairline), text link.
 *  - Hairline borders instead of heavy shadows; no gradient text, no hover jumps, no emoji.
 *  - Content is always visible: no scroll-reveal that hides content.
 */

export type MarketingContext = {
  trial: number;
  sale: string;
  list: string;
  save: string;
  savePercent: number;
  period: string;
  message: string;
  esc: (value: unknown) => string;
  /** ₹ per student per month. */
  rate?: string | number;
  minimum?: string;
  minStudents?: string | number;
};

const SHOT = "/demo/shots";
/** Intrinsic sizes of the resized screenshots, so lazy images reserve their space (no layout jump). */
const DIMS: Record<string, [number, number]> = {"01-parent-home": [720, 1605], "02-parent-message-school": [720, 1605], "04-teacher-apply-leave": [720, 1605], "05-teacher-attendance": [720, 1605], "06-teacher-timetable": [720, 1605], "07-teacher-attendance-qr": [720, 1605], "08-office-fees-register": [720, 1605], "09-office-roles-permissions": [720, 1605], "10-office-collect-fee": [720, 1600], "11-office-fees-report": [1600, 902], "12-office-dashboard-cover": [720, 1605], "13-fee-receipt": [1600, 816], "14-office-routine-desktop-v2": [1600, 819], "15-office-school-setup": [1600, 807], "16-school-website": [1600, 809], "17-parent-exam-result": [720, 1605], "18-office-notifications": [720, 1605], "19-office-attendance-overview": [720, 1605], "20-office-new-notice": [720, 1605], "21-parent-attendance-switch-child": [720, 1605], "22-teacher-month-register": [720, 1323], "office-dashboard": [1280, 800], "fees-operations": [1280, 800], "fees-register-2026": [1600, 760]};
function img(file: string, alt: string, eager = false) {
  const d = DIMS[file];
  return `<img src="${SHOT}/${file}.jpg" alt="${alt}"${d ? ` width="${d[0]}" height="${d[1]}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

/**
 * Social proof. Add REAL schools only — the section stays hidden until at least one entry exists.
 * Logos go in public/demo/logos/ (SVG or transparent PNG, ~160x48); reference them as "/demo/logos/<file>".
 */
export const PROOF_LOGOS: { name: string; src: string }[] = [];
export const TESTIMONIALS: { quote: string; name: string; role: string; school: string; city?: string }[] = [];

/** Phone screens: file, caption, who it is for. */
export const PHONE_SHOTS = [
  { file: "01-parent-home", role: "parent", title: "Parent home", text: "Attendance, last result and fees due at one glance." },
  { file: "17-parent-exam-result", role: "parent", title: "Exam results", text: "Subject-wise marks with a downloadable report card." },
  { file: "02-parent-message-school", role: "parent", title: "Message the school", text: "A numbered request thread instead of a phone call." },
  { file: "21-parent-attendance-switch-child", role: "parent", title: "Attendance", text: "Month calendar per child; switch children in one tap." },
  { file: "05-teacher-attendance", role: "teacher", title: "Mark attendance", text: "Whole class in under a minute. P / L / A per student." },
  { file: "07-teacher-attendance-qr", role: "teacher", title: "Teacher QR", text: "A self-refreshing QR the school's scanner reads." },
  { file: "06-teacher-timetable", role: "teacher", title: "Today's periods", text: "The teacher's own routine, with recess and room." },
  { file: "04-teacher-apply-leave", role: "teacher", title: "Apply for leave", text: "Balance shown; approvals route to the right person." },
  { file: "22-teacher-month-register", role: "teacher", title: "Month register", text: "Below-75% and absent-today filters, per student." },
  { file: "12-office-dashboard-cover", role: "office", title: "Office desk", text: "Gaps, idle staff, overdue fees and collection trend." },
  { file: "08-office-fees-register", role: "office", title: "Fees register", text: "Overdue by student, total due, collected today." },
  { file: "10-office-collect-fee", role: "office", title: "Collect a fee", text: "Cash, UPI, pay link or bank. The receipt goes to the parent." },
  { file: "19-office-attendance-overview", role: "office", title: "Attendance overview", text: "Every class's register status before 10 AM." },
  { file: "20-office-new-notice", role: "office", title: "Send a notice", text: "Parents, teachers or students; preview before sending." },
  { file: "18-office-notifications", role: "office", title: "Notifications", text: "Leave requests, holidays and papers in one feed." },
  { file: "09-office-roles-permissions", role: "office", title: "Roles & permissions", text: "Decide who sees what, area by area." },
] as const;

/** The real Anekio mark (same artwork as mobile/assets/anekio-mark-transparent.svg). */
const MARK = `<svg class="mk-mark" viewBox="0 30 200 142" aria-hidden="true" focusable="false"><path d="M100 115C65 60 15 68 15 115c0 45 50 55 85 0Z" fill="none" stroke="#3B82F6" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><path d="M100 115c35-55 85-47 85 0 0 45-50 55-85 0Z" fill="none" stroke="#22C55E" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="75" r="10" fill="#60A5FA"/><path d="M80 110c10-20 20-22 20-22s10 2 20 22" fill="none" stroke="#60A5FA" stroke-width="9" stroke-linecap="round"/><circle cx="100" cy="40" r="5" fill="#4ADE80"/><circle cx="88" cy="52" r="4.5" fill="#4ADE80"/><circle cx="112" cy="52" r="4.5" fill="#4ADE80"/></svg>`;
const brand = (cls = "") => `<a class="mk-brand ${cls}" href="/" aria-label="Anekio home">${MARK}<span>anekio</span></a>`;

const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function phone(file: string, alt: string, cls = "", eager = false) {
  return `<figure class="mk-phone ${cls}"><div class="mk-phone-shell">${img(file, alt, eager)}</div></figure>`;
}

function window_(file: string, alt: string, title: string, cls = "", eager = false) {
  return `<figure class="mk-window ${cls}"><div class="mk-window-bar"><span class="mk-dots"><i></i><i></i><i></i></span><span class="mk-window-title">${title}</span></div><div class="mk-window-body">${img(file, alt, eager)}</div></figure>`;
}

const SITE = "https://anekio.com";
/** Icons, theme colour and the social-share card. Absolute URLs because crawlers and chat apps need them. */
export function socialHead(image = `${SITE}/demo/og-anekio.png`) {
  return `<link rel="icon" type="image/svg+xml" href="/demo/anekio-mark.svg"><link rel="apple-touch-icon" href="/favicon.png"><meta name="theme-color" content="#08090c"><meta property="og:site_name" content="Anekio"><meta property="og:locale" content="en_IN"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Anekio: run your whole school from one record"><meta name="twitter:image" content="${image}">`;
}

export function marketingHead() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">${socialHead()}`;
}

/** CSS is authored with "$ " standing for the page scope so every rule outranks the shared shell styles. */
const CSS = `
html:has(body.marketing-page){background:#fff;scroll-padding-top:72px}
$ {--bg:#fff;--soft:#f7f8fa;--ink:#0b0d12;--ink-2:#3a404d;--muted:#5b6170;--line:#e7e9ee;--line-2:#d9dce3;--brand:#2563eb;--brand-hover:#1d4ed8;--green:#16a34a;--dark:#08090c;--dark-line:rgba(255,255,255,.09);--dark-muted:#9aa1ad;--r:14px;--font:"Geist",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-family:var(--font);color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;font-feature-settings:"ss01"}
$ main{overflow-x:clip}
$ *{box-sizing:border-box}
$ .wrap{width:min(1200px,calc(100% - 48px));margin:0 auto}
$ h1,$ h2,$ h3{font-family:var(--font);font-weight:600;letter-spacing:-.035em;color:inherit}
$ p{text-wrap:pretty}
$ h1,$ h2,$ h3{text-wrap:balance}

/* buttons — one shape, one height, three kinds */
$ .btn,$ #start .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:44px;padding:0 20px;border-radius:999px;border:1px solid transparent;font:500 15px/1 var(--font);letter-spacing:-.01em;box-shadow:none;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease;transform:none}
$ .btn:hover,$ #start .btn:hover,$ #start .btn.primary:hover{transform:none}
$ .btn svg{width:14px;height:14px}
$ .btn.primary,$ #start .btn.primary{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(11,13,18,.16)}
$ .btn.primary:hover,$ #start .btn.primary:hover{background:var(--brand-hover);border-color:var(--brand-hover);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(11,13,18,.16)}
$ .btn.primary:disabled{opacity:.5;cursor:not-allowed}
$ .btn.light,$ #start .btn.light{background:#fff;border-color:var(--line-2);color:var(--ink)}
$ .btn.light:hover,$ #start .btn.light:hover{background:var(--soft);border-color:#c9cdd6}
$ .btn.ghost{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.16);color:#fff}
$ .btn.ghost:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.26)}
$ .btn.sm{height:36px;padding:0 15px;font-size:14px}
$ .mk-link{display:inline-flex;align-items:center;gap:4px;font-weight:500;color:var(--brand)}
$ .mk-link svg{width:14px;height:14px;transition:transform .15s ease}
$ .mk-link:hover svg{transform:translateX(2px)}
$ :focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* type */
$ .eyebrow{display:inline-block;color:var(--brand);font:600 14px/1.2 var(--font);letter-spacing:-.005em;text-transform:none}
$ .eyebrow:before{display:none}
$ .section-title{font-size:clamp(28px,3.2vw,42px);line-height:1.1;letter-spacing:-.035em;margin:10px 0 12px;max-width:32ch;color:var(--ink)}
$ .lead{font-size:clamp(16px,1.3vw,18px);line-height:1.6;color:var(--muted);max-width:58ch;margin:0}
$ .center{text-align:center}
$ .center .section-title,$ .center .lead{margin-left:auto;margin-right:auto}
$ .mk-section{padding:clamp(56px,6.5vw,96px) 0}

/* brand */
$ .mk-brand{display:inline-flex;align-items:center;gap:10px;color:inherit;font:600 21px/1 var(--font);letter-spacing:-.04em}
$ .mk-mark{width:34px;height:auto;flex:0 0 auto}

/* nav */
$ .nav{position:sticky;top:0;z-index:50;background:var(--dark);border-bottom:1px solid var(--dark-line);box-shadow:none;color:#fff;transition:background-color .25s ease,border-color .25s ease,color .25s ease}
$ .nav.is-light{background:#fff;border-bottom-color:var(--line);color:var(--ink)}
$ .nav .wrap{height:64px;display:flex;align-items:center;justify-content:space-between;gap:24px}
$ .mk-nav-links{display:flex;align-items:center;gap:4px;margin:0 auto 0 28px}
$ .mk-nav-links a{padding:8px 12px;border-radius:999px;font-size:14px;font-weight:500;color:rgba(255,255,255,.7);transition:color .15s ease,background-color .15s ease}
$ .mk-nav-links a:hover{color:#fff;background:rgba(255,255,255,.06)}
$ .nav.is-light .mk-nav-links a{color:var(--ink-2)}
$ .nav.is-light .mk-nav-links a:hover{color:var(--ink);background:var(--soft)}
$ .mk-nav-actions{display:flex;align-items:center;gap:8px}
$ .mk-login{padding:8px 12px;font-size:14px;font-weight:500;color:rgba(255,255,255,.8)}
$ .mk-login:hover{color:#fff}
$ .nav.is-light .mk-login{color:var(--ink-2)}
$ .nav.is-light .mk-login:hover{color:var(--ink)}
$ .mobile-nav{display:none;position:relative}
$ .mobile-nav summary{list-style:none;cursor:pointer;width:38px;height:38px;display:grid;place-items:center;border-radius:999px;border:1px solid rgba(255,255,255,.16)}
$ .mobile-nav summary::-webkit-details-marker{display:none}
$ .mobile-nav summary svg{width:18px;height:18px}
$ .nav.is-light .mobile-nav summary{border-color:var(--line-2)}
$ .mobile-nav-menu{position:absolute;right:0;top:48px;width:240px;display:grid;gap:2px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 24px 48px -12px rgba(11,13,18,.22);color:var(--ink)}
$ .mobile-nav-menu a{padding:10px 12px;border-radius:10px;font-size:15px;font-weight:500}
$ .mobile-nav-menu a:hover{background:var(--soft)}
$ .mobile-nav-menu .btn{margin-top:6px;width:100%}

/* hero */
$ .mk-hero{position:relative;background:var(--dark);color:#fff;isolation:isolate;padding-top:clamp(48px,6vw,88px)}
$ .mk-hero-bg{position:absolute;inset:0 0 auto;height:820px;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:56px 56px;background-position:center top;-webkit-mask-image:radial-gradient(60% 55% at 50% 30%,#000 25%,transparent 75%);mask-image:radial-gradient(60% 55% at 50% 30%,#000 25%,transparent 75%)}
$ .mk-hero:before{content:"";position:absolute;inset:0 0 auto;height:720px;z-index:-1;pointer-events:none;background:radial-gradient(48% 60% at 50% 0%,rgba(37,99,235,.28),transparent 70%),radial-gradient(30% 40% at 72% 8%,rgba(34,197,94,.10),transparent 70%)}
$ .mk-hero-copy{display:flex;flex-direction:column;align-items:center;text-align:center;gap:22px;animation:mk-rise .7s cubic-bezier(.22,1,.36,1) both}
$ .mk-pill{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px 0 10px;border-radius:999px;border:1px solid var(--dark-line);background:rgba(255,255,255,.04);font-size:13px;font-weight:500;color:#cfd3da;transition:border-color .15s ease,background-color .15s ease}
$ .mk-pill:hover{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.07)}
$ .mk-pill i{width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}
$ .mk-pill svg{width:12px;height:12px;color:var(--dark-muted)}
$ .mk-hero h1{margin:0;font-size:clamp(44px,6vw,78px);line-height:.98;letter-spacing:-.05em;max-width:none}
$ .mk-hero h1 span{display:block;color:transparent;background:linear-gradient(180deg,#a7adb8,#6b7280);-webkit-background-clip:text;background-clip:text}
$ .mk-hero .lead{color:var(--dark-muted);max-width:54ch;font-size:clamp(16px,1.4vw,19px)}
$ .mk-hero .cta{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:4px}
$ .mk-hero-note{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 20px;margin:0;font-size:13px;color:#a3a9b4}
$ .mk-hero-note span{display:inline-flex;align-items:center;gap:6px}
$ .mk-hero-note svg{width:13px;height:13px;color:#22c55e}
$ .mk-msg{margin:0;padding:10px 14px;border:1px solid rgba(96,165,250,.35);border-radius:12px;background:rgba(37,99,235,.12);color:#dbeafe;font-size:13px;font-weight:500}
$ .mk-hero-stage-wrap{margin-top:clamp(40px,5vw,64px);background:linear-gradient(var(--dark) 0 58%,var(--bg) 58% 100%)}
$ .mk-hero-stage{position:relative;animation:mk-rise .9s .1s cubic-bezier(.22,1,.36,1) both;perspective:1600px}
$ .mk-float{position:absolute;z-index:3;display:flex;align-items:center;gap:10px;padding:10px 14px 10px 10px;border-radius:14px;background:#151922;border:1px solid rgba(255,255,255,.1);box-shadow:0 20px 40px -12px rgba(0,0,0,.6);font-size:13px;color:#e6e8ec;white-space:nowrap;}
$ .mk-float b{display:block;font-weight:600;color:#fff;font-size:13px}
$ .mk-float span{display:block;font-size:12px;color:#9aa1ad;margin-top:1px}
$ .mk-float i{flex:0 0 30px;height:30px;border-radius:9px;display:grid;place-items:center;font-style:normal}
$ .mk-float i svg{width:15px;height:15px}
$ .mk-float.f1{left:-2%;top:16%}
$ .mk-float.f1 i{background:rgba(34,197,94,.15);color:#4ade80}
$ .mk-float.f2{right:-1%;top:6%;animation-delay:1.5s}
$ .mk-float.f2 i{background:rgba(59,130,246,.18);color:#7ea7ff}
$ .mk-float.f3{left:6%;top:52%;animation-delay:3s}
$ .mk-float.f3 i{background:rgba(245,185,63,.16);color:#f5c451}
$ .mk-hero-stage .mk-window{box-shadow:0 0 0 1px rgba(255,255,255,.1),0 50px 120px -30px rgba(37,99,235,.45),0 30px 60px -20px rgba(0,0,0,.6)}
$ .mk-hero-phone{position:absolute;right:3%;bottom:-7%;width:16%;max-width:200px;z-index:2}
@keyframes mk-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* window + phone frames */
$ .mk-window{margin:0;border-radius:var(--r);overflow:hidden;background:#fff;border:1px solid var(--line);box-shadow:0 1px 2px rgba(11,13,18,.04),0 24px 64px -24px rgba(11,13,18,.18)}
$ .mk-window-bar{display:flex;align-items:center;gap:12px;height:36px;padding:0 14px;background:#f6f7f9;border-bottom:1px solid #eceef2;font-size:12px;font-weight:500;color:#8a909b}
$ .mk-dots{display:flex;gap:6px}
$ .mk-dots i{width:10px;height:10px;border-radius:50%;background:#dcdfe5}
$ .mk-window-title{flex:1;text-align:center;margin-right:42px}
$ .mk-window-body{position:relative;overflow:hidden;background:#fff}
$ .mk-window img{display:block;width:100%;height:auto}
$ .mk-window.crop-receipt .mk-window-body{aspect-ratio:16/10}
$ .mk-window.crop-receipt img{position:absolute;top:-2%;left:-34%;width:168%;max-width:none}
$ .mk-window.crop-fees .mk-window-body{aspect-ratio:1.62}
$ .mk-window.crop-fees img{position:absolute;top:0;left:-16.5%;width:126%;max-width:none}
$ .mk-phone{margin:0}
$ .mk-phone-shell{position:relative;aspect-ratio:9/19.4;background:#0b0d12;border-radius:30px;padding:6px;box-shadow:0 0 0 1px rgba(255,255,255,.06) inset,0 30px 60px -20px rgba(11,13,18,.45)}
$ .mk-phone-shell img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:24px;background:#fff}

/* module marquee */
$ .mk-strip{padding:clamp(48px,6vw,72px) 0 0;text-align:center}
$ .mk-strip > p{text-align:center;margin:0 auto 20px;font-size:13px;font-weight:500;color:var(--muted)}
$ .mk-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
$ .mk-marquee ul{list-style:none;margin:0;padding:4px 0;display:flex;gap:12px;width:max-content;animation:mk-marq 40s linear infinite}
$ .mk-marquee:hover ul{animation-play-state:paused}
$ .mk-marquee li{display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 18px 0 8px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:15px;font-weight:500;letter-spacing:-.015em;color:var(--ink-2);white-space:nowrap;box-shadow:0 1px 2px rgba(11,13,18,.03)}
$ .mk-marquee li i{display:grid;place-items:center;width:30px;height:30px;border-radius:999px;background:#eef3ff;color:var(--brand)}
$ .mk-marquee li i svg{width:16px;height:16px}
@keyframes mk-marq{to{transform:translateX(calc(-50% - 6px))}}

/* stats */
$ .mk-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:clamp(40px,5vw,64px);text-align:left}
$ .mk-stat{position:relative;overflow:hidden;padding:24px 24px 26px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,#fff,var(--soft));min-height:176px;display:flex;flex-direction:column}
$ .mk-stat em{font-style:normal;font-size:12px;font-weight:500;color:var(--muted);display:flex;align-items:center;gap:8px}
$ .mk-stat em i{width:6px;height:6px;border-radius:50%;background:var(--brand)}
$ .mk-stat b{display:block;margin-top:auto;padding-top:24px;font-size:clamp(40px,4.2vw,56px);font-weight:600;letter-spacing:-.05em;line-height:1;color:var(--ink)}
$ .mk-stat b small{font-size:.5em;color:var(--muted);margin-left:3px;letter-spacing:-.02em}
$ .mk-stat span{display:block;margin-top:10px;color:var(--muted);font-size:14px;line-height:1.45}
$ .mk-stat.is-dark{background:radial-gradient(80% 90% at 100% 0%,rgba(37,99,235,.45),transparent 70%),var(--dark);border-color:var(--dark)}
$ .mk-stat.is-dark em,$ .mk-stat.is-dark span{color:#9aa1ad}
$ .mk-stat.is-dark em i{background:#22c55e}
$ .mk-stat.is-dark b{color:#fff}
$ .mk-stat.is-dark b small{color:#9aa1ad}

/* record flow */
$ .mk-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(24px,4vw,48px);margin-top:56px}
$ .mk-flow article{border-top:1px solid var(--line-2);padding-top:22px}
$ .mk-flow .n{display:block;font:500 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--brand);margin-bottom:18px}
$ .mk-flow strong{display:block;font-size:19px;font-weight:600;letter-spacing:-.025em;margin-bottom:8px}
$ .mk-flow p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}

/* one record: copy + synced live panel */
$ .mk-live-cap{display:none}
$ .mk-one-label{position:relative;display:flex;align-items:center;justify-content:space-between;max-width:380px;margin:0 auto 16px;font-size:12px;font-weight:500;color:#9aa1ad}
$ .mk-one-label b{color:#fff;font-weight:600}
$ .mk-one-label i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-right:8px;vertical-align:1px}
$ .mk-one{display:grid;grid-template-columns:1fr 1fr;gap:clamp(40px,6vw,96px);align-items:center}
$ .mk-one-copy .section-title{max-width:16ch}
$ .mk-steps-v{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:4px}
$ .mk-steps-v li{position:relative;display:flex;gap:14px;padding:12px 0;border-radius:16px;transition:background-color .3s ease;}
$ .mk-steps-v li.s2{animation-delay:2.5s}
$ .mk-steps-v li.s3{animation-delay:5s}
$ .mk-steps-v li > span{flex:0 0 32px;height:32px;border-radius:10px;display:grid;place-items:center;font:600 13px/1 var(--font);color:var(--brand);background:#eef3ff}
$ .mk-steps-v strong{display:block;font-size:17px;font-weight:600;letter-spacing:-.02em}
$ .mk-steps-v p{margin:4px 0 0;font-size:14px;line-height:1.55;color:var(--muted)}
$ .mk-one-stage{position:relative;border-radius:24px;padding:clamp(20px,2.4vw,32px);background:radial-gradient(70% 60% at 80% 0%,rgba(37,99,235,.35),transparent 70%),radial-gradient(50% 40% at 0% 100%,rgba(34,197,94,.12),transparent 70%),var(--dark);overflow:hidden}
$ .mk-one-stage:before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:40px 40px;-webkit-mask-image:radial-gradient(70% 70% at 50% 40%,#000,transparent);mask-image:radial-gradient(70% 70% at 50% 40%,#000,transparent)}
$ .mk-live{position:relative;display:grid;grid-template-columns:1fr;gap:0;max-width:380px;margin:0 auto}
$ .mk-live-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:grid;gap:8px;box-shadow:0 20px 40px -20px rgba(0,0,0,.6);}
$ .mk-live-card.s2{}
$ .mk-live-card.s3{animation-delay:5s}
$ .mk-live-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}
$ .mk-live-tag{font-weight:600;font-size:11px;color:var(--brand);background:#eef3ff;border-radius:999px;padding:3px 8px}
$ .mk-live-tag.green{color:var(--green);background:#e8f7ee}
$ .mk-live-tag.dark{color:#fff;background:var(--ink)}
$ .mk-live-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--ink-2)}
$ .mk-live-row b{font-weight:600;color:var(--ink)}
$ .mk-live-row.muted{color:var(--muted);font-size:12px;padding-top:8px;border-top:1px solid var(--line)}
$ .mk-live-row s{color:#a3a8b2;font-weight:400;margin-right:2px}
$ .mk-live-row em{font-style:normal;color:var(--green);font-size:12px;font-weight:500;margin-left:4px;animation-delay:5s}
$ .mk-live-btn{position:relative;height:36px;border-radius:999px;background:var(--green);color:#fff;font-size:13px;font-weight:500;display:grid;place-items:center;overflow:hidden;}
$ .mk-live-btn span{grid-area:1/1;display:inline-flex;align-items:center;gap:6px}
$ .mk-live-btn svg{width:14px;height:14px}
$ .mk-live-btn .t1{opacity:0;}
$ .mk-live-btn .t2{opacity:1;}
$ .mk-live-note{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:12px;background:var(--soft)}
$ .mk-live-note b{display:block;font-size:13px;font-weight:600}
$ .mk-live-note span{display:block;font-size:12px;color:var(--muted)}
$ .mk-live-ic{flex:0 0 24px;height:24px;border-radius:50%;background:var(--green);color:#fff;display:grid!important;place-items:center}
$ .mk-live-ic svg{width:13px;height:13px}
$ .mk-live-link{position:relative;width:2px;height:18px;margin:0 auto;background:repeating-linear-gradient(180deg,rgba(255,255,255,.25) 0 4px,transparent 4px 8px)}
$ .mk-live-link i{display:none;position:absolute;left:50%;top:0;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#60a5fa;box-shadow:0 0 0 4px rgba(96,165,250,.25);opacity:0;animation-delay:1.2s}
$ .mk-live-link + .mk-live-card + .mk-live-link i{animation-delay:3.7s}

/* proof */
$ .mk-proof{padding-top:clamp(56px,7vw,88px);text-align:center}
$ .mk-proof > p{margin:0 0 20px;font-size:13px;font-weight:500;color:var(--muted)}
$ .mk-logos{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:24px 48px}
$ .mk-logos img{height:36px;width:auto;max-width:160px;object-fit:contain;filter:grayscale(1);opacity:.7;transition:opacity .2s ease,filter .2s ease}
$ .mk-logos img:hover{filter:none;opacity:1}
$ .mk-quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:40px;text-align:left}
$ .mk-quote{margin:0;padding:28px;border:1px solid var(--line);border-radius:20px;background:#fff}
$ .mk-quote blockquote{margin:0 0 20px;font-size:16px;line-height:1.6;color:var(--ink);letter-spacing:-.01em}
$ .mk-quote b{display:block;font-size:14px;font-weight:600}
$ .mk-quote span{display:block;font-size:13px;color:var(--muted);margin-top:2px}

/* segmented tabs */
$ .mk-seg{display:inline-flex;gap:2px;padding:4px;border-radius:999px;background:#eef0f3;border:1px solid var(--line);max-width:100%;overflow-x:auto;scrollbar-width:none}
$ .mk-seg::-webkit-scrollbar{display:none}
$ .mk-seg button{appearance:none;border:0;background:transparent;height:38px;padding:0 18px;border-radius:999px;font:500 14px/1 var(--font);color:var(--ink-2);cursor:pointer;white-space:nowrap;transition:background-color .15s ease,color .15s ease,box-shadow .15s ease}
$ .mk-seg button:hover{color:var(--ink)}
$ .mk-seg button[aria-selected="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(11,13,18,.08),0 0 0 1px rgba(11,13,18,.04)}
$ .mk-seg button{position:relative;overflow:hidden}
$ .mk-seg.is-playing button[aria-selected="true"]:after{content:"";position:absolute;left:16px;right:16px;bottom:3px;height:3px;border-radius:3px;background:var(--brand);transform:scaleX(0);transform-origin:left;animation:mk-progress var(--mk-dur,6000ms) linear forwards}
@keyframes mk-progress{to{transform:scaleX(1)}}
$ [data-panel][hidden]{display:none!important}
$ [data-panel]:not([hidden]){animation:mk-slide .55s cubic-bezier(.22,1,.36,1) both}
$ .mk-role-shots:not([hidden]) .mk-phone{animation:mk-slide .6s cubic-bezier(.22,1,.36,1) both}
$ .mk-role-shots:not([hidden]) .mk-phone:nth-child(2){animation-delay:.07s}
$ .mk-role-shots:not([hidden]) .mk-phone:nth-child(3){animation-delay:.14s}
@keyframes mk-slide{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
$ .mk-seg-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
$ .mk-wf .mk-seg-row{justify-content:center}
$ .mk-steps{display:flex;gap:6px}
$ .mk-step{display:grid;place-items:center;width:38px;height:38px;border-radius:999px;border:1px solid var(--line-2);background:#fff;color:var(--ink-2);cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
$ .mk-step:hover{color:var(--ink);border-color:#c3c8d1;background:var(--soft)}
$ .mk-step svg{width:14px;height:14px}
@keyframes mk-fade{from{opacity:0}to{opacity:1}}

/* points */
$ .mk-points{display:grid;gap:12px;margin:0;padding:0;list-style:none}
$ .mk-points li{display:flex;gap:10px;align-items:flex-start;color:var(--ink-2);font-size:15px;line-height:1.5}
$ .mk-points li svg{flex:0 0 18px;width:18px;height:18px;margin-top:2px;padding:3px;border-radius:50%;background:#e8f7ee;color:var(--green)}

/* roles */
$ .mk-roles{background:var(--soft);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
$ .mk-role-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:clamp(32px,6vw,88px);align-items:center;margin-top:28px}
$ .mk-role-copy .mk-seg-row{margin-bottom:32px}
$ .mk-roles-head{display:grid;grid-template-columns:1.1fr 1fr;gap:clamp(24px,5vw,80px);align-items:end}
$ .mk-roles-head .section-title{margin-bottom:0}
$ .mk-role-panel h3{font-size:clamp(24px,2.4vw,30px);line-height:1.15;margin:0 0 12px}
$ .mk-role-panel p{color:var(--muted);margin:0 0 24px;font-size:16px;line-height:1.6}
$ .mk-role-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(12px,2vw,24px);align-items:end}
$ .mk-role-shots .mk-phone:nth-child(2){margin-bottom:24px}
$ .mk-role-shots figcaption{margin-top:14px;text-align:center;font-size:13px;font-weight:500;color:var(--muted)}

/* role reel — endless carousel */
$ .mk-reel{margin-top:56px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
$ .mk-reel-track{--g:28px;display:flex;gap:var(--g);width:max-content;padding:8px 0 12px;}
$ .mk-reel .mk-phone{flex:0 0 220px;width:220px}
$ .mk-reel figcaption{margin-top:14px;text-align:center}
$ .mk-reel figcaption b{display:block;font-size:14px;font-weight:500;color:var(--ink)}
$ .mk-reel figcaption i,$ .mk-role-tag{display:inline-block;margin-bottom:6px;font-style:normal;font-size:11px;font-weight:600;text-transform:capitalize;padding:3px 9px;border-radius:999px}
$ .mk-reel figcaption i.parent,$ .mk-role-tag.parent{background:#e8f7ee;color:#15803d}
$ .mk-reel figcaption i.teacher,$ .mk-role-tag.teacher{background:#eef3ff;color:#1d4ed8}
$ .mk-reel figcaption i.office,$ .mk-role-tag.office{background:#fff4e0;color:#9a5b00}
$ .mk-role-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(24px,4vw,48px);margin-top:64px}
$ .mk-role-col{border-top:1px solid var(--line-2);padding-top:24px}
$ .mk-role-col h3{font-size:20px;line-height:1.25;letter-spacing:-.025em;margin:10px 0 8px}
$ .mk-role-col p{margin:0 0 18px;color:var(--muted);font-size:15px;line-height:1.6}

/* workflows */
$ .mk-wf{margin-top:28px;display:flex;flex-direction:column;align-items:center}
$ .mk-wf-panel{display:grid;grid-template-columns:.75fr 1.25fr;gap:clamp(32px,5vw,72px);align-items:center;width:100%;margin-top:32px}
$ .mk-wf-copy h3{font-size:clamp(24px,2.4vw,32px);line-height:1.12;margin:12px 0 14px;max-width:20ch}
$ .mk-wf-copy p{color:var(--muted);font-size:16px;line-height:1.65;margin:0 0 24px}

/* modules grid */
$ .mk-grid{display:grid;grid-template-columns:repeat(4,1fr);margin-top:36px;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:var(--line);gap:1px}
$ .mk-grid article{position:relative;background:#fff;padding:28px 24px 30px;transition:background-color .2s ease}
$ .mk-grid article:hover{background:#fbfbfc}
$ .mk-ico{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;color:var(--brand);background:linear-gradient(180deg,#f3f7ff,#e9f0ff);box-shadow:inset 0 0 0 1px rgba(37,99,235,.12);margin-bottom:24px}
$ .mk-ico svg{width:24px;height:24px}
$ .mk-grid h3{font-size:16px;letter-spacing:-.02em;margin:0 0 6px}
$ .mk-grid p{margin:0;color:var(--muted);font-size:14px;line-height:1.55}
$ .mk-grid .tag{position:absolute;top:24px;right:20px;font-size:11px;font-weight:500;color:var(--green);background:#e8f7ee;border-radius:999px;padding:3px 8px}

/* trust promises */
$ .mk-trust{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:36px}
$ .mk-trust article{padding:26px 24px 28px;border:1px solid var(--line);border-radius:20px;background:#fff;transition:border-color .2s ease,box-shadow .2s ease}
$ .mk-trust article:hover{border-color:var(--line-2);box-shadow:0 12px 32px -18px rgba(11,13,18,.2)}
$ .mk-trust i{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:#eef3ff;color:var(--brand);margin-bottom:20px}
$ .mk-trust i.g{background:#e8f7ee;color:var(--green)}
$ .mk-trust i svg{width:20px;height:20px}
$ .mk-trust h3{font-size:17px;letter-spacing:-.02em;margin:0 0 6px}
$ .mk-trust p{margin:0;font-size:14px;line-height:1.6;color:var(--muted)}

/* early partner band */
$ .mk-early{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(24px,4vw,56px);align-items:center;padding:clamp(28px,4vw,44px);border-radius:24px;border:1px solid #c7d7fb;background:radial-gradient(70% 120% at 100% 0%,rgba(37,99,235,.10),transparent 70%),linear-gradient(180deg,#f7f9ff,#fff)}
$ .mk-early .badge-new{display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 12px;border-radius:999px;background:#fff;border:1px solid #c7d7fb;font-size:12px;font-weight:600;color:var(--brand)}
$ .mk-early .badge-new i{width:6px;height:6px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.18)}
$ .mk-early h2{font-size:clamp(26px,3vw,38px);line-height:1.1;letter-spacing:-.04em;margin:14px 0 10px}
$ .mk-early > div > p{margin:0;color:var(--muted);font-size:16px;line-height:1.6;max-width:52ch}
$ .mk-early ul{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:12px}
$ .mk-early li{display:flex;gap:10px;font-size:15px;color:var(--ink-2);line-height:1.45}
$ .mk-early li svg{flex:0 0 18px;width:18px;height:18px;margin-top:2px;padding:3px;border-radius:50%;background:#e8f7ee;color:var(--green)}
$ .mk-early .cta{display:flex;gap:10px;flex-wrap:wrap}

/* support promise */
$ .mk-support{position:relative;background:var(--dark);color:#fff;isolation:isolate;overflow:hidden}
$ .mk-support:before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(40% 60% at 15% 20%,rgba(34,197,94,.14),transparent 70%),radial-gradient(45% 60% at 90% 80%,rgba(37,99,235,.28),transparent 70%)}
$ .mk-support-top{display:grid;grid-template-columns:1.1fr 1fr;gap:clamp(32px,6vw,96px);align-items:end}
$ .mk-support .eyebrow{color:#4ade80}
$ .mk-support .section-title{color:#fff;max-width:20ch;margin-bottom:0}
$ .mk-support-top .lead{color:var(--dark-muted)}
$ .mk-support-top .lead b{color:#fff;font-weight:500}
$ .mk-sflow{list-style:none;margin:36px 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;counter-reset:s}
$ .mk-sflow li{position:relative;padding:24px 22px 26px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid var(--dark-line);transition:background-color .2s ease,border-color .2s ease}
$ .mk-sflow li:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.16)}
$ .mk-sflow li i{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:rgba(74,222,128,.12);color:#4ade80;margin-bottom:22px}
$ .mk-sflow li i svg{width:20px;height:20px}
$ .mk-sflow li:before{counter-increment:s;content:"0" counter(s);position:absolute;top:24px;right:22px;font:500 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#5b6170}
$ .mk-sflow h3{font-size:17px;letter-spacing:-.02em;margin:0 0 6px;color:#fff}
$ .mk-sflow p{margin:0;font-size:14px;line-height:1.6;color:var(--dark-muted)}
$ .mk-support-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-top:12px;padding:20px 24px;border-radius:20px;background:linear-gradient(90deg,rgba(74,222,128,.10),rgba(37,99,235,.12));border:1px solid var(--dark-line)}
$ .mk-support-bar p{margin:0;font-size:15px;color:#e6e8ec}
$ .mk-support-bar p b{color:#fff}
$ .mk-support-bar .live{display:inline-flex;align-items:center;gap:8px;margin-right:10px;font-size:13px;color:#4ade80}
$ .mk-support-bar .live i{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);}

/* faq */
$ .mk-faq{max-width:840px;margin:0 auto}
$ .mk-faq-side{text-align:center;margin-bottom:32px}
$ .mk-faq-side .section-title{margin-left:auto;margin-right:auto}
$ .mk-faq-side .lead{margin:0 auto}
$ .mk-faq-list{display:grid;gap:10px}
$ .mk-faq-list details{border:1px solid var(--line);border-radius:16px;background:#fff;transition:border-color .2s ease,box-shadow .2s ease,background-color .2s ease}
$ .mk-faq-list details:hover{border-color:var(--line-2)}
$ .mk-faq-list details[open]{background:var(--soft);border-color:var(--line-2);box-shadow:0 12px 32px -20px rgba(11,13,18,.25)}
$ .mk-faq-list summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 22px;font-size:16px;font-weight:500;letter-spacing:-.015em;color:var(--ink)}
$ .mk-faq-list summary::-webkit-details-marker{display:none}
$ .mk-faq-list summary:after{content:"";flex:0 0 28px;height:28px;border-radius:999px;background:var(--soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%233a404d' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat;transition:transform .25s ease,background-color .2s ease}
$ .mk-faq-list details[open] summary:after{transform:rotate(180deg);background-color:#fff}
$ .mk-faq-list details p{margin:-4px 0 0;padding:0 70px 22px 22px;font-size:15px;line-height:1.7;color:var(--muted)}
$ .mk-faq-more{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:24px;padding:20px 22px;border-radius:16px;background:var(--dark);color:#fff}
$ .mk-faq-more b{display:block;font-size:16px;font-weight:600}
$ .mk-faq-more span{display:block;font-size:14px;color:var(--dark-muted);margin-top:2px}

/* before → after */
$ .mk-swap{margin-top:32px;border:1px solid var(--line);border-radius:24px;overflow:hidden;background:#fff}
$ .mk-swap-head,$ .mk-swap-row{display:grid;grid-template-columns:1fr 56px 1.15fr;align-items:center}
$ .mk-swap-head{padding:18px 28px;background:var(--soft);border-bottom:1px solid var(--line);font-size:13px;font-weight:600;color:var(--muted)}
$ .mk-swap-head span:last-child{display:flex;align-items:center;gap:8px;color:var(--ink)}
$ .mk-swap-head .mk-mark{width:24px}
$ .mk-swap-row{padding:22px 28px;border-top:1px solid var(--line);transition:background-color .2s ease}
$ .mk-swap-row:first-of-type{border-top:0}
$ .mk-swap-row:hover{background:#fbfcff}
$ .mk-swap-row b{display:block;font-size:16px;font-weight:600;letter-spacing:-.015em}
$ .mk-swap-row span{display:block;margin-top:4px;font-size:14px;line-height:1.5;color:var(--muted)}
$ .mk-swap-row .old b{color:#8a909b;text-decoration:line-through;text-decoration-color:rgba(229,72,77,.55);text-decoration-thickness:1.5px}
$ .mk-swap-row .old span{color:#9aa0aa}
$ .mk-swap-row > i{display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:var(--soft);border:1px solid var(--line);color:var(--muted)}
$ .mk-swap-row > i svg{width:14px;height:14px}
$ .mk-swap-row .new{display:flex;gap:12px}
$ .mk-swap-row .new b{color:var(--ink)}
$ .mk-swap-row .new em{flex:0 0 22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#e8f7ee;color:var(--green);margin-top:1px}
$ .mk-swap-row .new em svg{width:12px;height:12px}

/* compare */
$ .mk-compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:56px}
$ .mk-compare article{border-radius:20px;padding:32px;border:1px solid var(--line);background:#fff}
$ .mk-compare .old{background:var(--soft)}
$ .mk-compare .new{border-color:#c7d7fb;box-shadow:0 0 0 4px rgba(37,99,235,.05)}
$ .mk-compare h3{font-size:20px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
$ .mk-compare h3 .mk-mark{width:26px}
$ .mk-compare small{display:block;color:var(--muted);font-size:14px;margin-bottom:24px}
$ .mk-compare ul{list-style:none;margin:0;padding:0;display:grid}
$ .mk-compare li{display:flex;gap:14px;align-items:flex-start;padding:16px 0;border-top:1px solid var(--line);font-size:14px;line-height:1.5;color:var(--muted)}
$ .mk-compare li b{display:block;color:var(--ink);font-weight:500;font-size:15px;margin-bottom:2px}
$ .mk-compare li i{flex:0 0 20px;height:20px;border-radius:50%;display:grid;place-items:center;font-style:normal;margin-top:1px}
$ .mk-compare li i svg{width:12px;height:12px}
$ .mk-compare .old li i{background:#eceef2;color:#7a808b}
$ .mk-compare .new li i{background:#e8f7ee;color:var(--green)}
$ .mk-facts{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 32px;margin:40px 0 0;padding:0;list-style:none}
$ .mk-facts li{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--ink-2)}
$ .mk-facts svg{width:14px;height:14px;color:var(--green)}

/* closeout + footer: one full-width dark block */
$ .mk-end{position:relative;background:var(--dark);color:#fff;overflow:hidden;isolation:isolate}
$ .mk-end:before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(45% 60% at 18% 0%,rgba(37,99,235,.28),transparent 70%),radial-gradient(35% 50% at 90% 10%,rgba(34,197,94,.10),transparent 70%)}
$ .mk-close{display:grid;grid-template-columns:1.3fr 1fr;gap:clamp(32px,5vw,80px);align-items:end;padding:clamp(56px,7vw,96px) 0 clamp(48px,5vw,72px);border-bottom:1px solid var(--dark-line)}
$ .mk-close .section-title{color:#fff;max-width:18ch;margin:12px 0 0;font-size:clamp(32px,4vw,52px)}
$ .mk-close .eyebrow{color:#7ea7ff}
$ .mk-close-side .lead{color:var(--dark-muted);margin:0 0 28px;max-width:44ch}
$ .mk-close-side .cta{display:flex;gap:10px;flex-wrap:wrap}
$ .mk-close-points{display:flex;flex-wrap:wrap;gap:8px 20px;margin:24px 0 0;padding:0;list-style:none;font-size:13px;color:#8b919c}
$ .mk-close-points li{display:inline-flex;align-items:center;gap:6px}
$ .mk-close-points svg{width:13px;height:13px;color:#22c55e}
$ footer{background:transparent;border:0;padding:clamp(56px,7vw,80px) 0 0;color:var(--dark-muted)}
$ .footer-grid{display:grid;grid-template-columns:1.6fr repeat(4,1fr);gap:40px;align-items:start}
$ footer .mk-brand{color:#fff}
$ .footer-brand p{margin:18px 0 20px;max-width:34ch;font-size:14px;line-height:1.65;color:var(--dark-muted)}
$ .footer-mail{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border:1px solid var(--dark-line);border-radius:999px;font-size:14px;color:#e6e8ec;transition:border-color .15s ease,background-color .15s ease}
$ .footer-mail:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.04)}
$ .footer-mail svg{width:15px;height:15px}
$ .footer-col h4{margin:0 0 16px;font:500 13px/1 var(--font);color:#fff}
$ .footer-col a{display:block;padding:6px 0;font-size:14px;color:var(--dark-muted);transition:color .15s ease}
$ .footer-col a:hover{color:#fff}
$ .footer-word{margin:clamp(48px,6vw,72px) 0 0;font:600 clamp(80px,19vw,280px)/.8 var(--font);letter-spacing:-.07em;text-align:center;color:transparent;background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 85%);-webkit-background-clip:text;background-clip:text;user-select:none;pointer-events:none}
$ .footer-base{padding:22px 0 28px;border-top:1px solid var(--dark-line);font-size:13px;color:#8b919c;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
$ .footer-base a:hover{color:#fff}
$ .footer-base nav{display:flex;gap:18px}

/* get started (#start) — markup lives in anekio-site.ts; restyled to the same system */
$ #start{padding:clamp(56px,6.5vw,96px) 0;scroll-margin-top:72px;background:var(--soft);box-shadow:0 0 0 100vmax var(--soft);clip-path:inset(0 -100vmax)}
$ #start .start-head{max-width:640px;margin:0 auto 28px}
$ #start .start-head .section-title{font-size:clamp(32px,3.6vw,44px);max-width:none;margin:12px 0 10px}
$ #start .start-head .muted{font-size:16px;color:var(--muted)}
$ #start .eyebrow{font-size:13px}
$ #start .path-grid{max-width:960px;margin:0 auto 20px;gap:12px}
$ #start .path-card{min-height:0;border-radius:16px;padding:20px;background:#fff;border:1px solid var(--line);box-shadow:none;transition:border-color .15s ease,box-shadow .15s ease;animation:none;transform:none}
$ #start .path-card:hover{transform:none;border-color:var(--line-2);background:#fff;box-shadow:0 8px 24px -12px rgba(11,13,18,.15)}
$ #start .path-card.is-on,$ #start .path-card.is-on:hover{transform:none;animation:none;border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
$ #start .path-card .icon,$ #start .path-card:hover .icon,$ #start .path-card.is-on .icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;font-size:13px;font-weight:600;transform:none;background:var(--soft);border:1px solid var(--line);color:var(--ink)}
$ #start .path-card b{font-size:16px;font-weight:600;letter-spacing:-.02em;margin:14px 0 4px}
$ #start .path-card p{font-size:14px;font-weight:400;color:var(--muted)}
$ #start .path-card p strong{color:var(--ink);font-weight:600}
$ #start .path-old{font-weight:400}
$ #start .path-pop,$ #start .path-save{top:16px;right:16px;left:auto;border:0;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:500;letter-spacing:0;text-transform:none;background:var(--ink);color:#fff}
$ #start .path-save{background:#e8f7ee;color:var(--green)}
$ #start .start-split{max-width:960px;margin:0 auto;grid-template-columns:.85fr 1.15fr;gap:12px;align-items:stretch}
$ #start .two{gap:12px;align-items:end}
$ #start .two > label{align-content:end}
$ #start .form select,$ #start select{appearance:none;-webkit-appearance:none;padding-right:34px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%236b7280' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") right 12px center/14px no-repeat!important}
$ #start input:-webkit-autofill,$ #start select:-webkit-autofill{-webkit-box-shadow:0 0 0 40px #fff inset;-webkit-text-fill-color:var(--ink)}
$ #start .price-card,$ #start .form-shell{height:100%}
$ #start .offer-block > .eyebrow,$ #start .j-step > .eyebrow{display:block;margin-top:0;line-height:1.2}
$ #start .form-panel{padding-top:24px}
$ #start .price-card,$ #start .form-shell{border-radius:20px;border:1px solid var(--line);background:#fff;box-shadow:none}
$ #start .price-card{padding:32px}
$ #start .price-card .section-title,$ #start .start-heading{font-size:clamp(24px,2.4vw,30px);line-height:1.15;letter-spacing:-.035em;font-weight:600;margin:10px 0 8px;max-width:none}
$ #start .price{font-size:48px;font-weight:600;letter-spacing:-.05em}
$ #start .price-old{font-size:18px;font-weight:400}
$ #start .save{border:0;font-weight:500;font-size:13px;background:#e8f7ee;color:var(--green);padding:5px 10px}
$ #start .check-list{gap:12px;margin:24px 0}
$ #start .check-list span{font-weight:400;color:var(--ink-2);font-size:15px;align-items:center}
$ #start .check-list span:before{content:"";flex:0 0 18px;width:18px;height:18px;background:#e8f7ee url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.5 8.5l2.5 2.5 4.5-5.5' fill='none' stroke='%2316a34a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat}
$ #start .fine{font-size:13px;color:var(--muted)}
$ #start .form-shell:before,$ #start .form-shell:after{display:none}
$ #start .form-content{padding:8px!important}
$ #start .form-panel{border:0;border-radius:14px;padding:24px;box-shadow:none;background:#fff}
$ #start .form{gap:14px}
$ #start label{font-weight:500;font-size:13px;color:var(--ink-2);gap:6px}
$ #start input,$ #start select,$ #start textarea{height:42px;padding:0 12px;border:1px solid var(--line-2);border-radius:10px;font:400 15px var(--font);color:var(--ink);background:#fff;box-shadow:0 1px 2px rgba(11,13,18,.04);transition:border-color .15s ease,box-shadow .15s ease}
$ #start textarea{height:auto;padding:10px 12px}
$ #start input::placeholder{color:#a3a8b2}
$ #start input:focus,$ #start select:focus,$ #start textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.14)}
$ #start .form .btn{height:46px;margin-top:4px}
$ #start .cal-day{border-radius:12px;border-color:var(--line)}
$ #start .cal-day button{border-radius:999px;font-weight:500;border-color:var(--line-2);background:#fff}
$ #start .cal-day button.is-on{background:var(--brand);border-color:var(--brand);color:#fff}
$ #start .trial-error{border-radius:12px}
$ #start .contact-taken{margin:4px 0 2px;font-size:14px;line-height:1.5}
$ #start input.is-taken{border-color:#e5484d;box-shadow:0 0 0 3px rgba(229,72,77,.12)}
$ #start .section-title{max-width:none}

@media(prefers-reduced-motion:reduce){$ *{animation:none!important;transition:none!important}}
@media(max-width:1024px){
  $ .mk-nav-links{display:none}
  $ .mk-role-grid,$ .mk-wf-panel{grid-template-columns:1fr}
  $ .mk-role-shots{max-width:560px;margin:0 auto}
  $ .mk-grid{grid-template-columns:repeat(2,1fr)}
  $ .mk-stats{grid-template-columns:repeat(2,1fr)}
  $ .mk-role-cols{grid-template-columns:1fr}
  $ .mk-one{grid-template-columns:1fr}
  $ .mk-roles-head{grid-template-columns:1fr}
  $ .mk-support-top{grid-template-columns:1fr}
  $ .mk-sflow{grid-template-columns:1fr 1fr}
  $ .mk-trust{grid-template-columns:1fr 1fr}
  $ .mk-early{grid-template-columns:1fr}
  $ .mk-close{grid-template-columns:1fr;align-items:start}
  $ .footer-grid{grid-template-columns:repeat(2,1fr)}
  $ .footer-brand{grid-column:1/-1}
}
@media(max-width:900px){
  $ #start .start-split,$ #start .path-grid{grid-template-columns:1fr!important}
}
@media(max-width:768px){
  $ .wrap{width:calc(100% - 32px)}
  $ .mk-login,$ .mk-nav-actions .btn{display:none}
  $ .mobile-nav{display:block}
  $ .mk-hero h1{font-size:clamp(38px,10.5vw,56px)}
  $ .mk-hero h1 span{display:inline}
  $ .mk-hero .cta{width:100%;flex-direction:column}
  $ .mk-hero .cta .btn{width:100%}
  $ .mk-hero-phone,$ .mk-float{display:none}
  $ .mk-hero-stage .mk-window{transform:none}
  $ .mk-window-title{margin-right:0}
  $ .mk-stat{padding:18px 16px 20px;min-height:150px}
  $ .mk-stats{gap:10px}
  $ .mk-flow{grid-template-columns:1fr;gap:32px}
  $ .mk-reel .mk-phone{flex-basis:160px;width:160px}
  $ .mk-reel-track{--g:18px;animation-duration:55s}
  $ .mk-role-shots .mk-phone:nth-child(2){margin-bottom:0}
  $ .mk-role-shots figcaption{display:none}
  $ .mk-grid,$ .mk-compare,$ .mk-trust{grid-template-columns:1fr}
  $ .mk-swap-head{display:none}
  $ .mk-sflow{grid-template-columns:1fr}
  $ .mk-faq-list details p{padding-right:22px}
  $ .mk-swap-row{grid-template-columns:1fr;gap:10px;padding:20px}
  $ .mk-swap-row > i{transform:rotate(90deg)}
  $ .mk-early .cta .btn{flex:1}
  $ .mk-compare article{padding:24px}
  $ .footer-grid{grid-template-columns:1fr 1fr;gap:32px}
  $ .footer-brand{grid-column:1/-1}
  $ .mk-close-side .cta .btn{flex:1}
  $ #start .price-card{padding:24px}
  $ #start .form-panel{padding:16px}
}
`;

export function marketingCss() {
  return `<style>${CSS.replace(/\$ /g, "body.marketing-page ")}</style>`;
}

const ICONS: Record<string, string> = {
  website: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  admissions: `<svg viewBox="0 0 24 24" fill="none"><circle cx="10" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 19.5c.8-3.3 3.4-5.2 6.5-5.2 1.4 0 2.6.4 3.6 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.5" cy="17.5" r="4" fill="#22c55e"/><path d="M17.5 15.6v3.8M15.6 17.5h3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  fees: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h12v18l-2.5-1.6L13 21l-2-1.6L8.5 21 6 19.4V3z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 8h5M9.5 8.1c2.6 0 3.6 1 3.6 2.2S12 12.6 9.5 12.6l4 3.4M9.5 10.3h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.5" cy="5.5" r="2.5" fill="#22c55e"/></svg>`,
  attendance: `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15.2" r="3.4" fill="#22c55e"/><path d="M10.6 15.2l1 1 1.9-2" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  exams: `<svg viewBox="0 0 24 24" fill="none"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 3v5h5M8.5 12.5h4M8.5 16h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="15.5" r="2.6" fill="#22c55e"/></svg>`,
  routine: `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="10.2" y="10.2" width="3.6" height="3.6" rx="1" fill="#22c55e"/></svg>`,
  parents: `<svg viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5a2 2 0 0 1-2 2H9l-4.5 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9h7M8.5 12h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="19" cy="5" r="2.6" fill="#22c55e"/></svg>`,
  staff: `<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 5V3.5h5V5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11" r="2.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 17c.6-1.7 2.1-2.6 4-2.6s3.4.9 4 2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.5" cy="5.5" r="2.5" fill="#22c55e"/></svg>`,
  roles: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 21s7.5-3.6 7.5-9.4V5.6L12 3 4.5 5.6v6c0 5.8 7.5 9.4 7.5 9.4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11.2" r="3.2" fill="#22c55e"/><path d="M10.7 11.2l.9.9 1.7-1.8" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
const MENU = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 14h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const DASH = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

/** Tab buttons for a [data-tabset] group. */
function seg(label: string, items: [string, string][]) {
  const prev = `<button type="button" class="mk-step" data-step="-1" aria-label="Previous"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  const next = `<button type="button" class="mk-step" data-step="1" aria-label="Next">${ARROW}</button>`;
  return `<div class="mk-seg-row"><div class="mk-seg" role="tablist" aria-label="${label}">${items.map(([id, text], i) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${i === 0}">${text}</button>`).join("")}</div><div class="mk-steps">${prev}${next}</div></div>`;
}

/** Top navigation. `base` prefixes in-page anchors so the nav also works on /blog pages. */
export function marketingNav(base = "", light = false) {
  const links = `<a href="${base}#product">Product</a><a href="${base}#roles">Roles</a><a href="${base}#solutions">Workflows</a><a href="${base}#pricing" data-intent="pay">Pricing</a><a href="/blog">Blog</a>`;
  return `<nav class="nav${light ? " is-light" : ""}" id="mk-nav" aria-label="Primary navigation"><div class="wrap">${brand()}<div class="mk-nav-links">${links}</div><div class="mk-nav-actions"><a class="mk-login" href="/login" data-app-login>Log in</a><a class="btn primary sm" href="${base}#start" data-intent="demo">Book a free demo</a></div><details class="mobile-nav"><summary aria-label="Open navigation">${MENU}</summary><div class="mobile-nav-menu">${links}<a href="${base}#pricing" data-intent="pay">See pricing</a><a href="/login" data-app-login>Log in</a><a class="btn primary" href="${base}#start" data-intent="demo">Book a free demo</a></div></details></div></nav>`;
}

const MAIL = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 4.5L8 8.5l5.5-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function marketingFooter(base = "") {
  const col = (h: string, links: [string, string, string?][]) => `<div class="footer-col"><h4>${h}</h4>${links.map(([href, t, extra]) => `<a href="${href}"${extra || ""}>${t}</a>`).join("")}</div>`;
  return `<footer><div class="wrap"><div class="footer-grid">
  <div class="footer-brand">${brand()}<p>The complete school ecosystem for Indian schools. One student record for the office, teachers and parents.</p><a class="footer-mail" href="mailto:support@anekio.com">${MAIL}support@anekio.com</a></div>
  ${col("Product", [[`${base}#product`, "Overview"], [`${base}#roles`, "For every role"], [`${base}#solutions`, "Workflows"], [`${base}#pricing`, "Pricing", ' data-intent="pay"']])}
  ${col("Modules", [[`${base}#solutions`, "Fees & receipts"], [`${base}#roles`, "Attendance"], [`${base}#roles`, "Exams & report cards"], [`${base}#roles`, "Parent app"]])}
  ${col("Resources", [["/blog", "Blog"], [`${base}#support`, "Support"], [`${base}#faq`, "FAQ"], [`${base}#start`, "Book a demo", ' data-intent="demo"'], ["/login", "Log in", " data-app-login"]])}
  ${col("Company", [["mailto:support@anekio.com", "Contact"], ["/privacy", "Privacy"]])}
</div>
<div class="footer-word" aria-hidden="true">anekio</div>
<div class="footer-base"><span>© ${new Date().getFullYear()} Anekio. Made in India.</span><nav><a href="/privacy">Privacy</a><a href="mailto:support@anekio.com">Contact</a></nav></div></div></footer>`;
}

export function marketingTop(ctx: MarketingContext) {
  const { esc, message } = ctx;
  const nav = marketingNav();

  const RUPEE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h7M4.5 6h7M6 3c3.5 0 3.5 6 0 6H4.5l5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const DOC = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 2v3.5H13M6 9h4M6 11.5h2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const hero = `<section class="mk-hero">
    <div class="mk-hero-bg" aria-hidden="true"></div>
    <div class="wrap mk-hero-copy">
      <a class="mk-pill" href="#roles"><i></i>The complete school ecosystem · built for India ${ARROW}</a>
      <h1>Run your whole school <span>from one record.</span></h1>
      <p class="lead">Admissions, fees, attendance, exams, routine and the parent app share one student file, so nothing is retyped and nobody has to chase.</p>
      <div class="cta"><a class="btn primary" href="#start" data-intent="demo">Book a free demo</a><a class="btn ghost" href="#pricing" data-intent="pay">See pricing</a></div>
      <p class="mk-hero-note"><span>${CHECK}20-minute online demo</span><span>${CHECK}We set up your school for you</span><span>${CHECK}Your data stays yours</span></p>
      ${message ? `<p class="mk-msg">${esc(message)}</p>` : ""}
    </div>
    <div class="mk-hero-stage-wrap">
      <div class="wrap mk-hero-stage">
        ${window_("14-office-routine-desktop-v2", "Anekio office portal: drag-and-drop routine builder with teachers and the weekly grid", "Anekio · Routine", "", true)}
        ${phone("01-parent-home", "Anekio parent app home showing attendance, last result and fees due", "mk-hero-phone", true)}
        <div class="mk-float f1" aria-hidden="true"><i>${RUPEE}</i><div><b>₹8,600 collected</b><span>Receipt sent to parent · just now</span></div></div>
        <div class="mk-float f2" aria-hidden="true"><i>${CHECK}</i><div><b>Class 1-A marked</b><span>17 present · parents notified</span></div></div>
        <div class="mk-float f3" aria-hidden="true"><i>${DOC}</i><div><b>Term 1 results published</b><span>Report cards ready to download</span></div></div>
      </div>
    </div>
  </section>`;

  const modules: [string, string][] = [["admissions", "Admissions"], ["fees", "Fees & receipts"], ["attendance", "Attendance"], ["exams", "Exams & report cards"], ["routine", "Routine"], ["parents", "Parent app"], ["staff", "Teacher app"], ["staff", "Leave & payroll"], ["parents", "Notices"], ["website", "School website"], ["roles", "Roles & permissions"]];
  const chips = (hidden: boolean) => modules.map(([ic, m]) => `<li${hidden ? ' aria-hidden="true"' : ""}><i>${ICONS[ic]}</i>${m}</li>`).join("");
  const strip = `<section class="mk-strip" aria-label="What Anekio covers">
    <p class="wrap">Everything a school runs on, in one place</p>
    <div class="mk-marquee"><ul>${chips(false)}${chips(true)}</ul></div>
    <div class="wrap mk-stats">
      <div class="mk-stat"><em><i></i>Modules</em><b>12<small>+</small></b><span>on one school record</span></div>
      <div class="mk-stat"><em><i></i>Portals</em><b>4</b><span>office, teacher, parent and student</span></div>
      <div class="mk-stat"><em><i></i>Attendance</em><b>60<small>s</small></b><span>to mark a whole class present</span></div>
      <div class="mk-stat is-dark"><em><i></i>Simple pricing</em><b>₹${ctx.rate}</b><span>per student per month, billed yearly</span></div>
    </div>
  </section>`;

  const liveRecord = `<div class="mk-live" aria-label="Example: one fee payment updating every view">
        <div class="mk-live-card s1"><div class="mk-live-head"><span class="mk-live-tag">Office</span><span>Collect fee</span></div>
          <div class="mk-live-row"><b>Aanya Menon</b><span>2-A · ADM-201</span></div>
          <div class="mk-live-row"><span>October fee</span><b>₹8,600</b></div>
          <div class="mk-live-btn"><span class="t1">Collect ₹8,600 · UPI</span><span class="t2">${CHECK} Collected</span></div></div>
        <div class="mk-live-link"><i></i></div>
        <div class="mk-live-card s2"><div class="mk-live-head"><span class="mk-live-tag green">Parent app</span><span>Just now</span></div>
          <div class="mk-live-note"><span class="mk-live-ic">${CHECK}</span><div><b>Receipt received</b><span>₹8,600 · October fee · Aanya</span></div></div>
          <div class="mk-live-row muted"><span>Receipt RCPT-4097</span><span>Download</span></div></div>
        <div class="mk-live-link"><i></i></div>
        <div class="mk-live-card s3"><div class="mk-live-head"><span class="mk-live-tag dark">Fees register</span><span>Live</span></div>
          <div class="mk-live-row"><span>Students with dues</span><b>25 <em>−1</em></b></div>
          <div class="mk-live-row"><span>Collected this term</span><b>₹6.48L <em>+₹8,600</em></b></div>
          <div class="mk-live-row muted"><span>Overdue list</span><span>Updated</span></div></div>
      </div>
      <p class="mk-live-cap">One payment, recorded once. The parent, the register and the reports all update together.</p>`;

  const product = `<section id="product" class="mk-section">
    <div class="wrap mk-one">
      <div class="mk-one-copy">
        <span class="eyebrow">One platform</span><h2 class="section-title">Capture once. Use everywhere.</h2>
        <p class="lead">A student is admitted once. From then on fees, attendance, marks, documents and messages stay attached to that same record, on the office web portal and on every phone.</p>
        <ol class="mk-steps-v">
          <li class="s1"><span>01</span><div><strong>Admit the student</strong><p>The admission form becomes the working student file: class, parent, documents and billing month.</p></div></li>
          <li class="s2"><span>02</span><div><strong>Every team works on it</strong><p>Fees, attendance, exams, routine and notices read and write the same record. No spreadsheets in between.</p></div></li>
          <li class="s3"><span>03</span><div><strong>Each role sees what it needs</strong><p>Office gets control, teachers get their classes, parents get their child, with roles you decide.</p></div></li>
        </ol>
      </div>
      <div class="mk-one-stage"><p class="mk-one-label"><span><i></i><b>Example:</b> one fee payment</span><span>Updates everywhere</span></p>${liveRecord}</div>
    </div>
  </section>`;

  const points = (items: string[]) => `<ul class="mk-points">${items.map((x) => `<li>${CHECK}<span>${x}</span></li>`).join("")}</ul>`;
  const rolePanel = (role: "office" | "teacher" | "parent", h: string, p: string, items: string[], shots: string[]) => {
    const figs = shots
      .map((f) => {
        const meta = PHONE_SHOTS.find((s) => s.file === f);
        return `<figure class="mk-phone"><div class="mk-phone-shell">${img(f, esc(meta?.title || f))}</div><figcaption>${esc(meta?.title || "")}</figcaption></figure>`;
      })
      .join("");
    const hidden = role === "office" ? "" : " hidden";
    return {
      copy: `<div class="mk-role-panel" role="tabpanel" data-panel="${role}"${hidden}><h3>${h}</h3><p>${p}</p>${points(items)}</div>`,
      shots: `<div class="mk-role-shots" data-panel="${role}"${hidden}>${figs}</div>`,
    };
  };
  const office = rolePanel("office", "The office sees the whole day before it starts.", "Timetable gaps, absent teachers, overdue fees and today's registers, all on one desk. Collect a fee in four taps and the receipt reaches the parent.", ["Fees register, UPI / cash / pay-link collection, auto receipts", "Attendance overview across every class by 10 AM", "Notices to parents, teachers or students with a preview", "Roles & permissions, area by area"], ["08-office-fees-register", "12-office-dashboard-cover", "19-office-attendance-overview"]);
  const teacher = rolePanel("teacher", "Teachers lose the paperwork, not the control.", "Mark a class present in under a minute, see today's periods, hand over question papers and enter marks, all from the phone in their pocket.", ["Attendance with P / L / A per student and a month register", "Own timetable with recess and rooms", "Question-paper handover and marks entry with deadlines", "Apply for leave; balance and approver shown"], ["05-teacher-attendance", "06-teacher-timetable", "04-teacher-apply-leave"]);
  const parent = rolePanel("parent", "Parents get answers without calling the school.", "Attendance, fees due, exam results and notices for each child, plus a numbered request thread so a question never gets lost on WhatsApp.", ["Fees due with Pay now and downloadable receipts", "Subject-wise marks and the report card", "Attendance calendar; switch between children", "Message the office or the class teacher"], ["01-parent-home", "17-parent-exam-result", "02-parent-message-school"]);

  const roles = `<section id="roles" class="mk-section mk-roles">
    <div class="wrap" data-tabset data-autoplay="6000">
      <div class="mk-roles-head"><div><span class="eyebrow">For every role</span><h2 class="section-title">One school. Every role. Same truth.</h2></div><p class="lead">The same school from three different seats, on the web and in one Android app. These are real screens from the product.</p></div>
      <div class="mk-role-grid">
        <div class="mk-role-copy">
          ${seg("Anekio portals", [["office", "Office"], ["teacher", "Teacher"], ["parent", "Parent"]])}
          ${office.copy}${teacher.copy}${parent.copy}
        </div>
        <div>${office.shots}${teacher.shots}${parent.shots}</div>
      </div>
    </div>
  </section>`;

  const wf = (id: string, first: boolean, o: { eyebrow: string; h: string; p: string; items: string[]; shot: string; alt: string; title: string; cls?: string }) => `<div class="mk-wf-panel" role="tabpanel" data-panel="${id}"${first ? "" : " hidden"}>
      <div class="mk-wf-copy"><span class="eyebrow">${o.eyebrow}</span><h3>${o.h}</h3><p>${o.p}</p>${points(o.items)}</div>
      <div class="mk-wf-visual">${window_(o.shot, o.alt, o.title, o.cls || "")}</div>
    </div>`;

  const solutions = `<section id="solutions" class="mk-section">
    <div class="wrap" data-tabset data-autoplay="6000">
      <div class="center"><span class="eyebrow">Real school workflows</span><h2 class="section-title">Built around how a school actually runs.</h2><p class="lead">Not a generic ERP with a school skin. Every screen here is the live product.</p></div>
      <div class="mk-wf">
        ${seg("Anekio workflows", [["fees", "Fees & collections"], ["docs", "Receipts & documents"], ["web", "School website"], ["setup", "Guided setup"]])}
        ${wf("fees", true, { eyebrow: "Fees & collections", h: "From invoice to receipt without a single register.", p: "Class fee structures, late rules and add-ons issue invoices on their own. Collect in cash, UPI, pay link or bank, and the receipt lands on the parent's phone.", items: ["Outstanding, overdue and collected at a glance", "WhatsApp reminders to every overdue parent in one tap", "Call or message a parent straight from the register"], cls: "crop-fees", shot: "fees-register-2026", alt: "Anekio fees register: outstanding, overdue and collected totals with each student's due amount, status, fee period and last payment", title: "Anekio · Fees" })}
        ${wf("docs", false, { eyebrow: "Receipts, report cards & documents", h: "Documents that look like they came from your school.", p: "Receipts, report cards, ID cards and admission letters print with your letterhead, stamp and signature, and reach parents as a download, not a photo of a register.", items: ["Fee receipts with stamp, signature and QR", "Report cards published once every mark is in", "Student ID cards and documents on file"], shot: "13-fee-receipt", alt: "Anekio printable fee receipt with school header, payment details, signature and stamp", title: "Anekio · Fee receipt", cls: "crop-receipt" })}
        ${wf("web", false, { eyebrow: "Your school, online", h: "A school website with admissions built in.", p: "Every Anekio school gets a public website on its own address. Enquiries go straight into the admissions pipeline with follow-ups, calls and test schedules.", items: ["Admission enquiries land in the office inbox", "Parent app download links and notices", "Facilities, contact and campus pages"], shot: "16-school-website", alt: "Example school website generated by Anekio with an admissions-open banner", title: "yourschool.anekio.school" })}
        ${wf("setup", false, { eyebrow: "Guided setup", h: "Live in days, not a semester.", p: "A step-by-step checklist walks the office through school basics, classes, bell times, fees and people, and checks each step against real data before it is ticked.", items: ["Import students and parents from Excel", "Bell times, sessions and holidays in one place", "Setup help from the Anekio team included"], shot: "15-office-school-setup", alt: "Anekio school setup checklist showing progress through basics, sessions, classes and people", title: "Anekio · School setup" })}
      </div>
    </div>
  </section>`;

  const grid = `<section class="mk-section" style="padding-top:0">
    <div class="wrap">
      <div class="center"><span class="eyebrow">Everything, connected</span><h2 class="section-title">Modules that already know each other.</h2></div>
      <div class="mk-grid">
        <article><span class="mk-ico">${ICONS.admissions}</span><h3>Admissions & students</h3><p>Leads, follow-ups, entrance tests and admission in one pipeline. Excel import that follows your form.</p></article>
        <article><span class="mk-ico">${ICONS.fees}</span><span class="tag">UPI ready</span><h3>Fees & reminders</h3><p>Monthly invoices, late rules, discounts, pay links and auto reminders.</p></article>
        <article><span class="mk-ico">${ICONS.attendance}</span><h3>Attendance</h3><p>Class register in a minute, teacher QR check-in, month view per student.</p></article>
        <article><span class="mk-ico">${ICONS.exams}</span><h3>Exams</h3><p>Dates and timings, paper handover, marks, publish once, report cards.</p></article>
        <article><span class="mk-ico">${ICONS.routine}</span><h3>Routine</h3><p>Drag-and-drop timetable with clash detection and PDF export.</p></article>
        <article><span class="mk-ico">${ICONS.parents}</span><h3>Parent inbox & notices</h3><p>Numbered request threads and circulars with a preview.</p></article>
        <article><span class="mk-ico">${ICONS.staff}</span><h3>Staff, leave & payroll</h3><p>Leave balances and approvals, salary payments with proof.</p></article>
        <article><span class="mk-ico">${ICONS.roles}</span><h3>Roles & permissions</h3><p>Decide who can view or edit each area. Support access is time-boxed.</p></article>
      </div>
    </div>
  </section>`;

  const row = (b: string, t: string, mark: string) => `<li><i>${mark}</i><div><b>${b}</b>${t}</div></li>`;
  const ARR = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const swap = (oh: string, ot: string, nh: string, nt: string) => `<div class="mk-swap-row"><div class="old"><b>${oh}</b><span>${ot}</span></div><i>${ARR}</i><div class="new"><em>${CHECK}</em><div><b>${nh}</b><span>${nt}</span></div></div></div>`;
  const compare = `<section id="why" class="mk-section" style="padding-top:0">
    <div class="wrap">
      <div class="center"><span class="eyebrow">Why switch</span><h2 class="section-title">Registers and WhatsApp groups don't scale.</h2></div>
      <div class="mk-swap">
        <div class="mk-swap-head"><span>Today</span><span></span><span>${MARK}With Anekio</span></div>
        ${swap("Fees in a notebook", "Who paid, who's overdue and how much is a half-day reconciliation.", "Fees reconcile themselves", "Every receipt is attached to the student; the overdue list is live.")}
        ${swap("Attendance on paper", "The office finds out about absences at month end.", "Attendance by 10 AM", "The office sees which registers are done; parents see their child's day.")}
        ${swap("Results by photo", "Marks typed twice, report cards made in Word.", "Marks entered once", "Published to parents together, with a downloadable report card.")}
        ${swap("Parents call the office", "The same five questions, every day, to whoever picks up.", "Answers on the phone", "Fees, results and notices in the parent app; questions in a tracked thread.")}
      </div>
      <ul class="mk-facts" aria-label="Built for Indian schools">
        ${["Built for Indian schools", "UPI, cash and pay links", "Android app for parents & teachers", "Receipts with stamp & signature", "CBSE-style exam plans"].map((f) => `<li>${CHECK}${f}</li>`).join("")}
      </ul>
    </div>
  </section>`;

  const proof = PROOF_LOGOS.length || TESTIMONIALS.length ? `<section class="wrap mk-proof" aria-label="Schools using Anekio">
    ${PROOF_LOGOS.length ? `<p>Trusted by schools across India</p><div class="mk-logos">${PROOF_LOGOS.map((l) => `<img src="${esc(l.src)}" alt="${esc(l.name)}" loading="lazy">`).join("")}</div>` : ""}
    ${TESTIMONIALS.length ? `<div class="mk-quotes">${TESTIMONIALS.slice(0, 3).map((t) => `<figure class="mk-quote"><blockquote>“${esc(t.quote)}”</blockquote><figcaption><b>${esc(t.name)}</b><span>${esc(t.role)}, ${esc(t.school)}${t.city ? ` · ${esc(t.city)}` : ""}</span></figcaption></figure>`).join("")}</div>` : ""}
  </section>` : "";

  const trust = `<section class="mk-section" aria-label="What every school gets">
    <div class="wrap">
      <div class="center"><span class="eyebrow">Our promise</span><h2 class="section-title">What every school gets from day one.</h2><p class="lead">No lock-in, no hidden setup fees and no waiting on a call centre.</p></div>
      <div class="mk-trust"><article><i class="g"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Your data stays yours</h3><p>Export every student, fee and mark to Excel any time. If you ever leave, you take everything with you.</p></article><article><i class=""><svg viewBox="0 0 24 24" fill="none"><path d="M4 19.5l6-6M14.5 4.5a4 4 0 0 0-4.6 5.4L4 15.8 8.2 20l5.9-5.9a4 4 0 0 0 5.4-4.6l-2.6 2.6-2.8-.7-.7-2.8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Setup and training included</h3><p>Our team imports your students, sets up classes and fees, and trains the office and teachers. No extra charge.</p></article><article><i class=""><svg viewBox="0 0 24 24" fill="none"><path d="M4.5 13v-1a7.5 7.5 0 0 1 15 0v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3.5" y="13" width="4" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="16.5" y="13" width="4" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 19c0 1.2-1.5 2-4 2h-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Support from India</h3><p>Real people who know Indian schools. We reply within one working day, on email or WhatsApp.</p></article><article><i class="g"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5.5" width="18" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 10h18M7 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Payments through Razorpay</h3><p>Parents pay by UPI, card or net banking. Money goes to your school's account with a receipt carrying your stamp.</p></article><article><i class=""><svg viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Access you control</h3><p>Decide who sees fees, marks and records. Our support access is time-boxed and only when you allow it.</p></article><article><i class=""><svg viewBox="0 0 24 24" fill="none"><rect x="7" y="2.5" width="10" height="19" rx="2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 18.5h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Works on everyday phones</h3><p>The Android app runs on the mid-range phones teachers and parents already have, even on patchy networks.</p></article></div>
    </div>
  </section>`;

  const early = `<section class="mk-section" style="padding-top:0">
    <div class="wrap"><div class="mk-early">
      <div><span class="badge-new"><i></i>Launch offer · first 100 schools</span><h2>Your price, locked for as long as you stay.</h2><p>The first 100 schools on Anekio keep their launch price at every renewal, even when our prices go up. Each one is onboarded personally by our team.</p></div>
      <div>
        <ul><li>${CHECK}<span>Launch price locked at every renewal</span></li><li>${CHECK}<span>Hands-on setup with a dedicated person from our team</span></li><li>${CHECK}<span>Priority on the features you ask for</span></li></ul>
        <div class="cta"><a class="btn primary" href="#start" data-intent="demo">Book a free demo</a><a class="btn light" href="mailto:support@anekio.com?subject=Launch%20offer">Talk to us</a></div>
      </div>
    </div></div>
  </section>`;

  const support = `<section id="support" class="mk-section mk-support">
    <div class="wrap">
      <div class="mk-support-top">
        <div><span class="eyebrow">Support that shows up</span><h2 class="section-title">Any problem, we're on it right away.</h2></div>
        <p class="lead">A question, a doubt or something not working: tell us and a real person from our team picks it up immediately. <b>We listen, fix it fast and keep improving Anekio</b> from what your school tells us.</p>
      </div>
      <ol class="mk-sflow"><li><i><svg viewBox="0 0 24 24" fill="none"><path d="M20.5 14.5a2 2 0 0 1-2 2H9l-4.5 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9h7M8.5 12h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>Tell us however is easiest</h3><p>Email, a call or your dedicated contact. No ticket forms, no waiting in a queue.</p></li><li><i><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>A real person picks it up</h3><p>Someone from our team who knows your school replies on the same working day, usually much sooner.</p></li><li><i><svg viewBox="0 0 24 24" fill="none"><path d="M4 19.5l6-6M14.5 4.5a4 4 0 0 0-4.6 5.4L4 15.8 8.2 20l5.9-5.9a4 4 0 0 0 5.4-4.6l-2.6 2.6-2.8-.7-.7-2.8z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>We resolve it immediately</h3><p>Fees, attendance and exams come first. We get on a call if needed and stay with you until it's sorted.</p></li><li><i><svg viewBox="0 0 24 24" fill="none"><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></i><h3>We keep improving</h3><p>Every suggestion and issue shapes the next update, so Anekio gets better for your school every month.</p></li></ol>
      <div class="mk-support-bar"><p><span class="live"><i></i>Our team is here</span>Have a doubt right now? <b>Write to support@anekio.com</b> and a person will reply.</p><a class="btn ghost" href="mailto:support@anekio.com">Email support</a></div>
    </div>
  </section>`;

  const faqHtml = `<section id="faq" class="mk-section" style="padding-top:0">
    <div class="wrap mk-faq">
      <div class="mk-faq-side"><span class="eyebrow">Questions</span><h2 class="section-title">Any doubts? Ask away.</h2><p class="lead">The things schools ask us most.</p></div>
      <div class="mk-faq-list"><details open><summary>Do you offer a free trial?</summary><p>We start with a free 20-minute online demo on your own school's needs. When you decide to go ahead, our team sets up your school and trains your staff, so you never start with an empty system.</p></details><details><summary>How long does setup take?</summary><p>It depends on how much data you have. We import your students and parents from Excel, set up classes, fees and timetables, and train the office and teachers. We stay with you until your school is running day to day.</p></details><details><summary>What if we face a problem or have a doubt?</summary><p>Tell us by email or call your dedicated contact. A real person from our team picks it up right away, and anything touching fees, attendance or exams is resolved first. Your feedback goes straight into how we improve Anekio.</p></details><details><summary>Can we bring our existing data?</summary><p>Yes. We import students and parents from your Excel sheets, following your own admission form, along with opening fee balances so dues carry over correctly.</p></details><details><summary>How is the price worked out?</summary><p>₹${ctx.rate} per student per month, billed yearly, with a minimum of ₹${ctx.minimum || "12,000"} a year. Setup, training and the parent and teacher app are included.</p></details><details><summary>How do parents pay fees?</summary><p>By UPI, card or net banking through Razorpay, straight to your school's account. Cash and cheque payments at the counter go into the same ledger, and every payment gets a receipt with your stamp.</p></details><details><summary>Who owns our school's data?</summary><p>You do. Your student, fee and exam records belong to your school, and access is limited to the people you give permission to.</p></details><details><summary>Does it work on phones?</summary><p>Yes. Teachers and parents use the Android app, and the office uses a web portal in any normal browser.</p></details></div>
      <div class="mk-faq-more"><div><b>Still have a question?</b><span>A real person from our team will answer it.</span></div><a class="btn primary" href="mailto:support@anekio.com">Ask us</a></div>
    </div>
  </section>`;

  return nav + `<main>` + hero + strip + proof + product + roles + solutions + grid + compare + support + trust + faqHtml + early;
}

export function marketingBottom(ctx: MarketingContext) {
  void ctx;
  return `</main>
<div class="mk-end">
  <section id="close" class="wrap mk-close">
    <div><span class="eyebrow">Bring the school together</span><h2 class="section-title">Give every team one reliable place to work.</h2></div>
    <div class="mk-close-side">
      <p class="lead">See Anekio in a free 20-minute demo. When you're ready, our team sets up your school and trains your staff.</p>
      <div class="cta"><a class="btn primary" href="#start" data-intent="demo">Book a free demo</a><a class="btn ghost" href="#pricing" data-intent="pay">See pricing</a></div>
      <ul class="mk-close-points"><li>${CHECK}Setup included</li><li>${CHECK}Staff training</li><li>${CHECK}Your data stays yours</li></ul>
    </div>
  </section>
  ${marketingFooter()}
</div>`;
}

export function marketingScript() {
  return `<script>
  (function () {
    // Nav turns light once the dark hero scrolls away.
    var nav = document.getElementById("mk-nav");
    var hero = document.querySelector(".mk-hero-copy");
    if (nav && hero && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        nav.classList.toggle("is-light", !entries[0].isIntersecting);
      }, { rootMargin: "-64px 0px 0px 0px", threshold: 0 }).observe(hero);
    }
    // Log in links point at the app host.
    var host = location.hostname, port = location.port, login = "/login";
    if ((host === "localhost" || host === "127.0.0.1") && port === "4000") login = "http://localhost:8081/login";
    else if (host === "anekio.com" || host === "www.anekio.com") login = "https://app.anekio.com/login";
    else if (host === "staging.anekio.com") login = "https://app.staging.anekio.com/login";
    document.querySelectorAll("[data-app-login]").forEach(function (a) { a.setAttribute("href", login); });
    // Tabs: each [data-tabset] toggles its own [data-panel] elements.
    // With data-autoplay, it advances like a carousel (progress bar on the active tab) while on screen.
    // Picking a tab, an arrow or swiping jumps there and the countdown starts again from that view.
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll("[data-tabset]").forEach(function (set) {
      var tabs = Array.prototype.slice.call(set.querySelectorAll("[data-tab]"));
      var panels = set.querySelectorAll("[data-panel]");
      var seg = set.querySelector(".mk-seg");
      var delay = Number(set.getAttribute("data-autoplay")) || 0;
      var auto = delay > 0 && !reduce, timer = null, visible = false;
      var idx = 0;
      if (seg && auto) seg.style.setProperty("--mk-dur", delay + "ms");
      function restartBar() {
        if (!seg || !auto) return;
        seg.classList.remove("is-playing"); void seg.offsetWidth;
        if (visible) seg.classList.add("is-playing");
      }
      function show(i) {
        idx = (i + tabs.length) % tabs.length;
        var id = tabs[idx].getAttribute("data-tab");
        tabs.forEach(function (t) { t.setAttribute("aria-selected", t === tabs[idx] ? "true" : "false"); });
        panels.forEach(function (p) { if (p.getAttribute("data-panel") === id) p.removeAttribute("hidden"); else p.setAttribute("hidden", ""); });
        restartBar();
      }
      function run() {
        clearInterval(timer); timer = null;
        if (auto && visible) timer = setInterval(function () { show(idx + 1); }, delay);
        restartBar();
      }
      function go(i) { show(i); run(); }
      set.querySelectorAll("[data-step]").forEach(function (b) {
        b.addEventListener("click", function () { go(idx + Number(b.getAttribute("data-step"))); });
      });
      tabs.forEach(function (t, i) {
        t.addEventListener("click", function () { go(i); });
        t.addEventListener("keydown", function (e) {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          go(idx + (e.key === "ArrowRight" ? 1 : -1)); tabs[idx].focus();
        });
      });
      if (delay > 0 && "IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; run(); }, { threshold: 0.35 }).observe(set);
      }
      // Swipe left/right on touch screens to move between views.
      var x0 = null, y0 = 0;
      set.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      set.addEventListener("touchend", function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest(".mk-seg")) { go(idx + (dx < 0 ? 1 : -1)); }
      }, { passive: true });
    });
    document.querySelectorAll(".mobile-nav-menu a").forEach(function (link) {
      link.addEventListener("click", function () { var menu = link.closest("details"); if (menu) menu.removeAttribute("open"); });
    });
  })();
</script>`;
}
