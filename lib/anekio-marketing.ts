/**
 * Anekio marketing page — presentation layer (nav, hero, product story, closeout, footer).
 * The "Get started" section (#start: demo / trial / pay journeys) lives in anekio-site.ts and is unchanged.
 * Screens come from real product screenshots in public/demo/shots.
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
};

const SHOT = "/demo/shots";
/** Intrinsic sizes of the resized screenshots, so lazy images reserve their space (no layout jump). */
const DIMS: Record<string, [number, number]> = {"01-parent-home": [720, 1605], "02-parent-message-school": [720, 1605], "04-teacher-apply-leave": [720, 1605], "05-teacher-attendance": [720, 1605], "06-teacher-timetable": [720, 1605], "07-teacher-attendance-qr": [720, 1605], "08-office-fees-register": [720, 1605], "09-office-roles-permissions": [720, 1605], "10-office-collect-fee": [720, 1600], "11-office-fees-report": [1600, 902], "12-office-dashboard-cover": [720, 1605], "13-fee-receipt": [1600, 816], "14-office-routine-desktop-v2": [1600, 819], "15-office-school-setup": [1600, 807], "16-school-website": [1600, 809], "17-parent-exam-result": [720, 1605], "18-office-notifications": [720, 1605], "19-office-attendance-overview": [720, 1605], "20-office-new-notice": [720, 1605], "21-parent-attendance-switch-child": [720, 1605], "22-teacher-month-register": [720, 1323], "office-dashboard": [1280, 800]};
function img(file: string, alt: string, eager = false) {
  const d = DIMS[file];
  return `<img src="${SHOT}/${file}.jpg" alt="${alt}"${d ? ` width="${d[0]}" height="${d[1]}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

/** Phone screens shown in the gallery and role switcher: file, caption, who it is for. */
export const PHONE_SHOTS = [
  { file: "01-parent-home", role: "parent", title: "Parent home", text: "Attendance, last result and fees due — one glance." },
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
  { file: "10-office-collect-fee", role: "office", title: "Collect a fee", text: "Cash, UPI, pay link or bank — receipt goes to the parent." },
  { file: "19-office-attendance-overview", role: "office", title: "Attendance overview", text: "Every class's register status before 10 AM." },
  { file: "20-office-new-notice", role: "office", title: "Send a notice", text: "Parents, teachers or students; preview before sending." },
  { file: "18-office-notifications", role: "office", title: "Notifications", text: "Leave requests, holidays and papers in one feed." },
  { file: "09-office-roles-permissions", role: "office", title: "Roles & permissions", text: "Decide who sees what, area by area." },
] as const;

function phone(file: string, alt: string, cls = "", eager = false) {
  return `<figure class="mk-phone ${cls}"><div class="mk-phone-shell"><span class="mk-phone-cam"></span>${img(file, alt, eager)}</div></figure>`;
}

function window_(file: string, alt: string, title: string, cls = "", eager = false) {
  return `<figure class="mk-window ${cls}"><div class="mk-window-bar"><span class="mk-dots"><i></i><i></i><i></i></span><span class="mk-window-title">${title}</span><span class="mk-live"><i></i>Live school record</span></div>${img(file, alt, eager)}</figure>`;
}

export function marketingHead() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">`;
}

export function marketingCss() {
  return `<style>
  body.marketing-page{--navy:#0b1530;--navy-2:#111f45;--ink:#0f172a;--muted:#5b6b85;--line:#e3e9f3;--blue:#2855f6;--blue-2:#4f7cff;--sky:#22c1f0;--mint:#14b889;--amber:#f5b93f;--rose:#ff5d7a;--paper:#fff;--soft:#f5f8fe;--font-display:"Sora",Inter,ui-sans-serif,system-ui,sans-serif;--font-body:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--ease:cubic-bezier(.22,1,.36,1);font-family:var(--font-body);color:var(--ink);background:#fff}
  body.marketing-page:before,body.marketing-page:after{display:none}
  body.marketing-page main,body.marketing-page .mk-hero{overflow-x:clip}
  body.marketing-page .wrap{width:min(1240px,calc(100% - 48px));margin:0 auto}
  body.marketing-page h1,body.marketing-page h2,body.marketing-page h3,body.marketing-page .mk-display{font-family:var(--font-display);letter-spacing:-.03em}
  body.marketing-page .btn{font-family:var(--font-body);font-weight:700;border-radius:12px;padding:13px 20px;transition:transform .25s var(--ease),box-shadow .25s var(--ease),background .2s}
  body.marketing-page .btn:hover{transform:translateY(-2px)}
  body.marketing-page .btn.primary{background:linear-gradient(135deg,var(--blue),var(--blue-2));border:0;box-shadow:0 14px 32px rgba(40,85,246,.32)}
  body.marketing-page .btn.primary:hover{box-shadow:0 20px 40px rgba(40,85,246,.4)}
  body.marketing-page .btn.ghost{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);color:#fff;backdrop-filter:blur(8px)}
  body.marketing-page .btn.ghost:hover{background:rgba(255,255,255,.14)}
  body.marketing-page .btn.light{background:#fff;border:1px solid var(--line);color:var(--ink);box-shadow:0 8px 20px rgba(15,23,42,.06)}
  body.marketing-page .eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--blue);font-weight:700;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
  body.marketing-page .eyebrow:before{content:"";width:18px;height:2px;border-radius:2px;background:currentColor}
  body.marketing-page .section-title{font-size:clamp(30px,3.6vw,46px);line-height:1.08;margin:12px 0 14px;max-width:18ch}
  body.marketing-page .lead{font-size:clamp(16px,1.2vw,18px);line-height:1.6;color:var(--muted);max-width:56ch;margin:0}
  body.marketing-page .center{text-align:center}body.marketing-page .center .section-title,body.marketing-page .center .lead{margin-left:auto;margin-right:auto}
  body.marketing-page .mk-section{padding:clamp(72px,9vw,120px) 0}
  /* nav */
  body.marketing-page .nav{position:sticky;top:0;z-index:40;background:rgba(11,21,48,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid rgba(255,255,255,.08);box-shadow:none;transition:background .3s,border-color .3s}
  body.marketing-page .nav.is-light{background:rgba(255,255,255,.86);border-bottom-color:var(--line)}
  body.marketing-page .nav .wrap{height:72px}
  body.marketing-page .brand{font-family:var(--font-display);font-size:22px;font-weight:800;color:#fff;transition:color .3s}
  body.marketing-page .nav.is-light .brand{color:var(--ink)}
  body.marketing-page .brand .mark{width:36px;height:36px;border-radius:11px;font-size:17px;box-shadow:0 10px 24px rgba(40,85,246,.35)}
  body.marketing-page .navlinks{gap:26px;font-weight:600;font-size:14px;color:rgba(255,255,255,.78)}
  body.marketing-page .navlinks a:hover{color:#fff}body.marketing-page .navlinks a:after{background:#fff}
  body.marketing-page .nav.is-light .navlinks{color:#334761}body.marketing-page .nav.is-light .navlinks a:hover{color:var(--blue)}body.marketing-page .nav.is-light .navlinks a:after{background:var(--blue)}
  body.marketing-page .nav-actions{display:flex;gap:10px}
  body.marketing-page .nav .btn.light{padding:10px 16px;background:transparent;border-color:rgba(255,255,255,.25);color:#fff;box-shadow:none}
  body.marketing-page .nav.is-light .btn.light{border-color:var(--line);color:var(--ink)}
  body.marketing-page .nav .btn.primary{padding:10px 16px;box-shadow:none}
  body.marketing-page .mobile-nav{display:none}
  /* hero */
  body.marketing-page .mk-hero{position:relative;overflow:hidden;background:var(--navy);color:#fff;padding:clamp(56px,8vw,100px) 0 0;isolation:isolate}
  body.marketing-page .mk-hero:before{content:"";position:absolute;inset:0;z-index:-2;background:radial-gradient(60% 50% at 15% 10%,rgba(40,85,246,.55),transparent 60%),radial-gradient(45% 40% at 90% 15%,rgba(34,193,240,.35),transparent 60%),radial-gradient(50% 45% at 70% 100%,rgba(20,184,137,.22),transparent 60%),var(--navy);animation:mk-mesh 18s ease-in-out infinite alternate}
  body.marketing-page .mk-hero:after{content:"";position:absolute;inset:0;z-index:-1;opacity:.35;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(ellipse 70% 60% at 50% 20%,#000 20%,transparent 75%)}
  @keyframes mk-mesh{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(14deg)}}
  body.marketing-page .mk-hero-grid{display:grid;grid-template-columns:1fr 1.05fr;gap:clamp(28px,4vw,56px);align-items:center}
  body.marketing-page .mk-hero-grid{padding-bottom:clamp(40px,5vw,72px)}
  body.marketing-page .mk-hero-copy{display:flex;flex-direction:column;align-items:flex-start;gap:20px}
  body.marketing-page .mk-chip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);border-radius:999px;padding:7px 12px 7px 8px;font-size:13px;font-weight:600;color:#dbe6ff;backdrop-filter:blur(6px)}
  body.marketing-page .mk-chip b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--mint);color:#06281c;font-size:11px}
  body.marketing-page .mk-hero h1{font-size:clamp(38px,5.2vw,68px);line-height:1.02;margin:0;max-width:12ch;font-weight:800}
  body.marketing-page .mk-grad{background:linear-gradient(92deg,#9ec1ff 0%,#5de3ff 48%,#8dffd2 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  body.marketing-page .mk-hero .lead{color:#b9c6e4;max-width:50ch;font-size:clamp(16px,1.25vw,19px)}
  body.marketing-page .mk-hero .cta{display:flex;gap:12px;flex-wrap:wrap}
  body.marketing-page .mk-hero .btn{padding:15px 22px;font-size:15px}
  body.marketing-page .mk-hero-note{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:#9fb0d3;font-weight:500}
  body.marketing-page .mk-hero-note span:before{content:"✓";color:#5de3ff;margin-right:6px;font-weight:800}
  body.marketing-page .mk-msg{margin:0;padding:10px 14px;border:1px solid rgba(93,227,255,.4);border-radius:10px;background:rgba(93,227,255,.12);color:#dffaff;font-size:13px;font-weight:600}
  body.marketing-page .mk-stage{position:relative;height:clamp(440px,44vw,640px);perspective:1400px}
  body.marketing-page .mk-window{margin:0;background:#0f172a;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.14);box-shadow:0 40px 90px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.3)}
  body.marketing-page .mk-window img{display:block;width:100%;height:auto}
  body.marketing-page .mk-window-bar{display:flex;align-items:center;gap:12px;padding:9px 12px;background:#141d33;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;color:#9fb0d3;font-weight:600}
  body.marketing-page .mk-dots{display:flex;gap:5px}body.marketing-page .mk-dots i{width:9px;height:9px;border-radius:50%;background:#2e3b5c}body.marketing-page .mk-dots i:nth-child(1){background:#ff5f57}body.marketing-page .mk-dots i:nth-child(2){background:#febc2e}body.marketing-page .mk-dots i:nth-child(3){background:#28c840}
  body.marketing-page .mk-window-title{flex:1}
  body.marketing-page .mk-live{display:inline-flex;align-items:center;gap:6px;color:#8dffd2}body.marketing-page .mk-live i{width:7px;height:7px;border-radius:50%;background:#14b889;box-shadow:0 0 0 0 rgba(20,184,137,.6);animation:mk-ping 2s infinite}
  @keyframes mk-ping{0%{box-shadow:0 0 0 0 rgba(20,184,137,.6)}70%{box-shadow:0 0 0 8px rgba(20,184,137,0)}100%{box-shadow:0 0 0 0 rgba(20,184,137,0)}}
  body.marketing-page .mk-phone{margin:0}
  body.marketing-page .mk-phone-shell{position:relative;width:100%;aspect-ratio:9/19.3;background:#0b0f1c;border-radius:30px;padding:9px;box-shadow:0 30px 70px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.12)}
  body.marketing-page .mk-phone-shell img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:22px;background:#fff}
  body.marketing-page .mk-phone-cam{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:10px;height:10px;border-radius:50%;background:#1f2937;z-index:2;box-shadow:0 0 0 3px #0b0f1c}
  body.marketing-page .mk-stage .mk-window{position:absolute;left:0;top:10%;width:74%;transform:rotateY(-6deg) rotateX(3deg);transform-origin:left center;animation:mk-float-a 9s ease-in-out infinite}
  body.marketing-page .mk-stage .mk-phone.a{position:absolute;right:2%;top:-2%;width:23%;z-index:3;animation:mk-float-b 8s ease-in-out infinite}
  body.marketing-page .mk-stage .mk-phone.b{position:absolute;right:26%;bottom:0;width:21%;z-index:2;animation:mk-float-c 10s ease-in-out infinite}
  @keyframes mk-float-a{0%,100%{transform:rotateY(-6deg) rotateX(3deg) translateY(0)}50%{transform:rotateY(-6deg) rotateX(3deg) translateY(-10px)}}
  @keyframes mk-float-b{0%,100%{transform:translateY(0) rotate(2deg)}50%{transform:translateY(-16px) rotate(2deg)}}
  @keyframes mk-float-c{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-12px) rotate(-3deg)}}
  body.marketing-page .mk-stage[data-parallax] > *{will-change:transform}
  /* ticker */
  body.marketing-page .mk-ticker{position:relative;border-top:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);overflow:hidden;padding:16px 0;mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
  body.marketing-page .mk-ticker-track{display:flex;gap:40px;width:max-content;animation:mk-ticker 38s linear infinite}
  body.marketing-page .mk-ticker:hover .mk-ticker-track{animation-play-state:paused}
  body.marketing-page .mk-ticker span{display:inline-flex;align-items:center;gap:10px;color:#c8d4f0;font-weight:600;font-size:14px;white-space:nowrap}
  body.marketing-page .mk-ticker span i{width:6px;height:6px;border-radius:50%;background:var(--sky)}
  @keyframes mk-ticker{to{transform:translateX(-50%)}}
  /* stats */
  body.marketing-page .mk-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:36px;position:relative;z-index:2}
  body.marketing-page .mk-stat{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px 22px 20px;box-shadow:0 20px 50px rgba(15,23,42,.08)}
  body.marketing-page .mk-stat b{display:block;font-family:var(--font-display);font-size:34px;letter-spacing:-.03em;line-height:1}
  body.marketing-page .mk-stat b small{font-size:20px;color:var(--blue);margin-left:2px}
  body.marketing-page .mk-stat span{display:block;margin-top:8px;color:var(--muted);font-size:13px;font-weight:600}
  /* record flow */
  body.marketing-page .mk-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px;position:relative}
  body.marketing-page .mk-flow:before{content:"";position:absolute;left:12%;right:12%;top:34px;height:2px;background:linear-gradient(90deg,var(--blue),var(--sky),var(--mint));opacity:.35;border-radius:2px}
  body.marketing-page .mk-flow article{position:relative;background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px 24px 24px;box-shadow:0 14px 40px rgba(15,23,42,.05);transition:transform .35s var(--ease),box-shadow .35s var(--ease)}
  body.marketing-page .mk-flow article:hover{transform:translateY(-8px);box-shadow:0 26px 60px rgba(40,85,246,.14)}
  body.marketing-page .mk-flow .n{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--sky));color:#fff;font-family:var(--font-display);font-weight:800;margin-bottom:16px;box-shadow:0 10px 24px rgba(40,85,246,.3)}
  body.marketing-page .mk-flow strong{display:block;font-family:var(--font-display);font-size:19px;margin-bottom:6px}
  body.marketing-page .mk-flow p{margin:0;color:var(--muted);font-size:14px;line-height:1.55}
  /* roles */
  body.marketing-page .mk-roles{background:var(--navy);color:#fff;position:relative;overflow:hidden}
  body.marketing-page .mk-roles:before{content:"";position:absolute;inset:0;background:radial-gradient(50% 60% at 80% 50%,rgba(40,85,246,.35),transparent 60%),radial-gradient(40% 50% at 10% 90%,rgba(20,184,137,.18),transparent 60%)}
  body.marketing-page .mk-roles .wrap{position:relative}
  body.marketing-page .mk-roles .eyebrow{color:#8dffd2}body.marketing-page .mk-roles .lead{color:#b9c6e4}
  body.marketing-page .mk-role-grid{display:grid;grid-template-columns:1fr 1.1fr;gap:clamp(28px,5vw,72px);align-items:center;margin-top:36px}
  body.marketing-page .mk-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:26px}
  body.marketing-page .mk-tab{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#dbe6ff;border-radius:999px;padding:10px 16px;font:600 14px var(--font-body);cursor:pointer;transition:background .2s,color .2s,border-color .2s}
  body.marketing-page .mk-tab[aria-selected="true"]{background:#fff;color:var(--navy);border-color:#fff}
  body.marketing-page .mk-role-panel[hidden],body.marketing-page .mk-role-shots[hidden]{display:none}
  body.marketing-page .mk-role-panel h3{font-size:clamp(24px,2.4vw,32px);margin:0 0 12px;line-height:1.15}
  body.marketing-page .mk-role-panel p{color:#b9c6e4;margin:0 0 20px;font-size:16px;line-height:1.6}
  body.marketing-page .mk-points{display:grid;gap:10px;margin:0;padding:0;list-style:none}
  body.marketing-page .mk-points li{display:flex;gap:12px;align-items:flex-start;color:#e6edff;font-weight:500;font-size:15px}
  body.marketing-page .mk-points li:before{content:"";flex:0 0 22px;height:22px;border-radius:50%;background:rgba(141,255,210,.15) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238dffd2' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 13l4 4L19 7'/%3E%3C/svg%3E") center/13px no-repeat}
  body.marketing-page .mk-role-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:end;min-height:460px}
  body.marketing-page .mk-role-shots .mk-phone{opacity:0;transform:translateY(24px);transition:opacity .5s var(--ease),transform .6s var(--ease)}
  body.marketing-page .mk-role-shots .mk-phone.is-in{opacity:1;transform:translateY(0)}
  body.marketing-page .mk-role-shots .mk-phone:nth-child(2){transform:translateY(0) scale(1.06);transition-delay:.08s}body.marketing-page .mk-role-shots .mk-phone:nth-child(2).is-in{transform:translateY(-14px) scale(1.06)}
  body.marketing-page .mk-role-shots .mk-phone:nth-child(3){transition-delay:.16s}
  body.marketing-page .mk-role-shots figcaption{margin-top:10px;text-align:center;font-size:12px;color:#9fb0d3;font-weight:600}
  /* showcase rows */
  body.marketing-page .mk-show{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,72px);align-items:center;padding:clamp(28px,4vw,56px) 0}
  body.marketing-page .mk-show.is-reverse .mk-show-copy{order:2}
  body.marketing-page .mk-show h3{font-size:clamp(24px,2.5vw,34px);line-height:1.12;margin:12px 0 12px;max-width:16ch}
  body.marketing-page .mk-show p{color:var(--muted);font-size:16px;line-height:1.65;margin:0 0 18px;max-width:48ch}
  body.marketing-page .mk-show .mk-points li{color:#243247}
  body.marketing-page .mk-show .mk-points li:before{background:#e9fff7 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23077354' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 13l4 4L19 7'/%3E%3C/svg%3E") center/13px no-repeat}
  body.marketing-page .mk-show .mk-window{box-shadow:0 30px 80px rgba(15,23,42,.18);border-color:#dbe3f0;transform:perspective(1200px) rotateY(0deg);transition:transform .6s var(--ease)}
  body.marketing-page .mk-show:not(.is-reverse) .mk-window:hover{transform:perspective(1200px) rotateY(-4deg) translateY(-6px)}
  body.marketing-page .mk-show.is-reverse .mk-window:hover{transform:perspective(1200px) rotateY(4deg) translateY(-6px)}
  body.marketing-page .mk-show-visual{position:relative}
  body.marketing-page .mk-show-visual .mk-phone.over{position:absolute;width:26%;right:-6%;bottom:-8%;z-index:2;animation:mk-float-c 9s ease-in-out infinite}
  body.marketing-page .mk-show-visual .mk-glow{position:absolute;inset:10% 0 -10%;z-index:-1;border-radius:40px;background:radial-gradient(60% 60% at 50% 50%,rgba(40,85,246,.18),transparent 70%);filter:blur(10px)}
  /* phone gallery */
  body.marketing-page .mk-gallery{overflow:hidden;padding:clamp(56px,7vw,96px) 0;background:linear-gradient(180deg,#fff,var(--soft))}
  body.marketing-page .mk-gallery-track{display:flex;gap:26px;width:max-content;padding:28px 0 16px;animation:mk-gallery 70s linear infinite}
  body.marketing-page .mk-gallery:hover .mk-gallery-track{animation-play-state:paused}
  @keyframes mk-gallery{to{transform:translateX(-50%)}}
  body.marketing-page .mk-gallery .mk-phone{width:220px;flex:0 0 220px;transition:transform .4s var(--ease)}
  body.marketing-page .mk-gallery .mk-phone:hover{transform:translateY(-10px) scale(1.03)}
  body.marketing-page .mk-gallery .mk-phone-shell{box-shadow:0 24px 50px rgba(15,23,42,.18)}
  body.marketing-page .mk-gallery figcaption{margin-top:12px;text-align:center}
  body.marketing-page .mk-gallery figcaption b{display:block;font-size:14px}body.marketing-page .mk-gallery figcaption span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
  body.marketing-page .mk-gallery figcaption i{display:inline-block;margin-bottom:6px;font-style:normal;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
  body.marketing-page .mk-gallery figcaption i.parent{background:#e9fff7;color:#077354}body.marketing-page .mk-gallery figcaption i.teacher{background:#eef4ff;color:#2246c7}body.marketing-page .mk-gallery figcaption i.office{background:#fff4e0;color:#9a5b00}
  /* bento */
  body.marketing-page .mk-bento{display:grid;grid-template-columns:repeat(6,1fr);gap:16px;margin-top:40px}
  body.marketing-page .mk-bento article{grid-column:span 2;background:#fff;border:1px solid var(--line);border-radius:22px;padding:24px;position:relative;overflow:hidden;transition:transform .35s var(--ease),box-shadow .35s var(--ease),border-color .35s}
  body.marketing-page .mk-bento article.wide{grid-column:span 3}
  body.marketing-page .mk-bento article:hover{transform:translateY(-6px);border-color:#c7d5f5;box-shadow:0 24px 56px rgba(40,85,246,.14)}
  body.marketing-page .mk-bento article:before{content:"";position:absolute;inset:auto -40px -60px auto;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(40,85,246,.12),transparent 70%);transition:transform .5s var(--ease)}
  body.marketing-page .mk-bento article:hover:before{transform:scale(1.6)}
  body.marketing-page .mk-ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:#eef4ff;color:var(--blue);margin-bottom:16px}
  body.marketing-page .mk-ico svg{width:22px;height:22px}
  body.marketing-page .mk-bento h3{font-size:18px;margin:0 0 6px}
  body.marketing-page .mk-bento p{margin:0;color:var(--muted);font-size:14px;line-height:1.55}
  body.marketing-page .mk-bento .tag{position:absolute;top:18px;right:18px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#077354;background:#e9fff7;border-radius:999px;padding:4px 8px}
  /* compare */
  body.marketing-page .mk-compare{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:36px}
  body.marketing-page .mk-compare article{border-radius:22px;padding:26px;border:1px solid var(--line)}
  body.marketing-page .mk-compare .old{background:#fbf7f1}body.marketing-page .mk-compare .new{background:linear-gradient(160deg,#eef4ff,#f6fbff);border-color:#c7d5f5}
  body.marketing-page .mk-compare h3{font-size:20px;margin:0 0 4px}body.marketing-page .mk-compare small{display:block;color:var(--muted);font-weight:600;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px}
  body.marketing-page .mk-compare ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
  body.marketing-page .mk-compare li{display:flex;gap:12px;align-items:flex-start;background:rgba(255,255,255,.8);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.45;color:#243247}
  body.marketing-page .mk-compare li i{flex:0 0 26px;height:26px;border-radius:8px;display:grid;place-items:center;font-style:normal;font-weight:800;font-size:13px}
  body.marketing-page .mk-compare .old li i{background:#fde8e8;color:#b42318}body.marketing-page .mk-compare .new li i{background:#e9fff7;color:#077354}
  body.marketing-page .mk-compare li b{display:block;margin-bottom:2px}
  /* india strip */
  body.marketing-page .mk-india{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:28px}
  body.marketing-page .mk-india span{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:10px 14px;font-weight:600;font-size:14px;box-shadow:0 8px 20px rgba(15,23,42,.04)}
  /* closeout */
  body.marketing-page .mk-close{position:relative;overflow:hidden;background:var(--navy);color:#fff;border-radius:30px;padding:clamp(40px,6vw,72px) clamp(22px,5vw,64px);text-align:center;isolation:isolate}
  body.marketing-page .mk-close:before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(50% 70% at 20% 0%,rgba(40,85,246,.6),transparent 60%),radial-gradient(40% 60% at 90% 100%,rgba(20,184,137,.35),transparent 60%)}
  body.marketing-page .mk-close .eyebrow{color:#8dffd2}body.marketing-page .mk-close .section-title{color:#fff;max-width:20ch;margin:12px auto}body.marketing-page .mk-close .lead{color:#b9c6e4;margin:0 auto 26px}
  body.marketing-page .mk-close .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
  body.marketing-page .mk-close .btn{padding:15px 22px;font-size:15px}
  /* footer */
  body.marketing-page footer{background:#fff;border-top:1px solid var(--line);padding:40px 0 28px;color:var(--muted)}
  body.marketing-page .footer-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:28px;align-items:start}
  body.marketing-page footer .brand{color:var(--ink);font-size:20px}body.marketing-page footer .brand .mark{width:32px;height:32px;border-radius:10px;font-size:15px}
  body.marketing-page .footer-brand p{margin:12px 0 0;max-width:40ch;font-size:14px;line-height:1.6}
  body.marketing-page .footer-links{display:flex;flex-wrap:wrap;gap:8px 22px;justify-content:flex-end;font-weight:600;font-size:14px;color:#334761}
  body.marketing-page .footer-links a:hover{color:var(--blue)}
  body.marketing-page .footer-base{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  /* reveal */
  body.marketing-page [data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .7s var(--ease),transform .8s var(--ease)}
  body.marketing-page [data-reveal].is-in{opacity:1;transform:none}
  body.marketing-page [data-reveal="left"]{transform:translateX(-28px)}body.marketing-page [data-reveal="right"]{transform:translateX(28px)}
  body.marketing-page [data-reveal-group] > *{opacity:0;transform:translateY(18px);transition:opacity .6s var(--ease),transform .7s var(--ease)}
  body.marketing-page [data-reveal-group].is-in > *{opacity:1;transform:none}
  body.marketing-page [data-reveal-group].is-in > :nth-child(2){transition-delay:.08s}body.marketing-page [data-reveal-group].is-in > :nth-child(3){transition-delay:.16s}body.marketing-page [data-reveal-group].is-in > :nth-child(4){transition-delay:.24s}body.marketing-page [data-reveal-group].is-in > :nth-child(5){transition-delay:.32s}body.marketing-page [data-reveal-group].is-in > :nth-child(6){transition-delay:.4s}body.marketing-page [data-reveal-group].is-in > :nth-child(7){transition-delay:.48s}body.marketing-page [data-reveal-group].is-in > :nth-child(8){transition-delay:.56s}
  /* get started section inherits shell styles; soften to match */
  body.marketing-page #start{padding:clamp(72px,9vw,110px) 0;scroll-margin-top:80px;background:var(--soft);box-shadow:0 0 0 100vmax var(--soft);clip-path:inset(0 -100vmax)}
  body.marketing-page #start .start-head{max-width:650px;margin:0 auto 34px}
  body.marketing-page #start .start-head .section-title{font-size:clamp(30px,3.4vw,42px);max-width:none}
  body.marketing-page #start .path-grid{max-width:920px;margin:0 auto 26px;gap:12px}
  body.marketing-page #start .path-card{min-height:110px;border-radius:16px;padding:18px;background:#fff;border-color:var(--line);box-shadow:0 8px 20px rgba(15,23,42,.04);transition:transform .3s var(--ease),border-color .2s,box-shadow .3s var(--ease)}
  body.marketing-page #start .path-card:hover{transform:translateY(-4px);border-color:#9aabe0;box-shadow:0 18px 40px rgba(40,85,246,.14)}
  body.marketing-page #start .path-card.is-on{transform:none;border-color:var(--blue);background:#f7f9ff;box-shadow:0 0 0 3px rgba(40,85,246,.14);animation:none}
  body.marketing-page #start .path-card .icon{width:34px;height:34px;border-radius:10px;font-size:13px;transform:none;background:#edf2ff}
  body.marketing-page #start .path-card b{font-size:15px}body.marketing-page #start .path-card p{font-size:12px;font-weight:600}
  body.marketing-page #start .path-pop,body.marketing-page #start .path-save{top:-9px;right:12px;left:auto;border:0;border-radius:999px;padding:3px 8px;background:var(--blue);color:#fff}
  body.marketing-page #start .path-save{background:#e9fff7;color:#077354;right:auto;left:12px}
  body.marketing-page #start .start-split{max-width:1000px;margin:0 auto;grid-template-columns:.8fr 1.2fr;gap:16px}
  body.marketing-page #start .price-card,body.marketing-page #start .form-shell{border-radius:20px;border-color:var(--line);background:#fff;box-shadow:0 20px 50px rgba(15,23,42,.06)}
  body.marketing-page #start .price-card{padding:26px}
  body.marketing-page #start .form-shell:before,body.marketing-page #start .form-shell:after{display:none}
  body.marketing-page #start .form-content{padding:8px!important}
  body.marketing-page #start .form-panel{border:0;border-radius:14px;padding:18px;box-shadow:none;background:#fff}
  body.marketing-page #start input,body.marketing-page #start select,body.marketing-page #start textarea{border-radius:10px;box-shadow:none}
  body.marketing-page #start .cal-day,body.marketing-page #start .cal-day button{border-radius:10px}
  body.marketing-page #start .section-title{max-width:none}
  @media(prefers-reduced-motion:reduce){body.marketing-page *{animation:none!important;transition:none!important}body.marketing-page [data-reveal],body.marketing-page [data-reveal-group] > *,body.marketing-page .mk-role-shots .mk-phone{opacity:1;transform:none}}
  @media(max-width:1024px){body.marketing-page .mk-hero-grid{grid-template-columns:1fr;gap:40px}body.marketing-page .mk-hero-copy{padding-bottom:0;align-items:center;text-align:center}body.marketing-page .mk-hero .cta{justify-content:center}body.marketing-page .mk-hero-note{justify-content:center}body.marketing-page .mk-stage{height:auto;aspect-ratio:1.45;margin-bottom:20px;max-width:560px;margin-left:auto;margin-right:auto}body.marketing-page .mk-stage .mk-window{width:80%;top:8%}body.marketing-page .mk-stage .mk-phone.a{width:24%;right:0;top:0}body.marketing-page .mk-stage .mk-phone.b{width:22%;right:14%;bottom:0}body.marketing-page .mk-stats{grid-template-columns:repeat(2,1fr)}body.marketing-page .mk-role-grid{grid-template-columns:1fr}body.marketing-page .mk-show,body.marketing-page .mk-show.is-reverse{grid-template-columns:1fr}body.marketing-page .mk-show.is-reverse .mk-show-copy{order:0}body.marketing-page .mk-bento article,body.marketing-page .mk-bento article.wide{grid-column:span 3}}
  @media(max-width:768px){body.marketing-page .wrap{width:min(1240px,calc(100% - 32px))}body.marketing-page .navlinks,body.marketing-page .nav-actions .btn.light{display:none}body.marketing-page .mobile-nav{display:block;position:relative}body.marketing-page .mobile-nav summary{list-style:none;cursor:pointer;width:40px;height:40px;display:grid;place-items:center;border-radius:10px;border:1px solid rgba(255,255,255,.25);color:#fff}body.marketing-page .nav.is-light .mobile-nav summary{border-color:var(--line);color:var(--ink)}body.marketing-page .mobile-nav-menu{position:absolute;right:0;top:48px;width:220px;display:grid;gap:4px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px;box-shadow:0 20px 50px rgba(15,23,42,.18)}body.marketing-page .mobile-nav-menu a{padding:10px 12px;border-radius:8px;color:var(--ink);font-weight:600}body.marketing-page .mobile-nav-menu a:hover{background:var(--soft)}body.marketing-page .mk-hero h1{font-size:38px}body.marketing-page .mk-stats{grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}body.marketing-page .mk-stat{padding:16px}body.marketing-page .mk-stat b{font-size:26px}body.marketing-page .mk-flow{grid-template-columns:1fr}body.marketing-page .mk-flow:before{display:none}body.marketing-page .mk-role-shots{grid-template-columns:repeat(3,1fr);gap:8px;min-height:0}body.marketing-page .mk-role-shots figcaption{display:none}body.marketing-page .mk-bento article,body.marketing-page .mk-bento article.wide{grid-column:span 6}body.marketing-page .mk-compare{grid-template-columns:1fr}body.marketing-page .mk-show-visual .mk-phone.over{display:none}body.marketing-page .mk-gallery .mk-phone{width:170px;flex-basis:170px}body.marketing-page .footer-grid{grid-template-columns:1fr}body.marketing-page .footer-links{justify-content:flex-start}}
</style>`;
}

const ICONS: Record<string, string> = {
  admissions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`,
  fees: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/></svg>`,
  attendance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  exams: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>`,
  routine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>`,
  parents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  staff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  roles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`,
};

export function marketingTop(ctx: MarketingContext) {
  const { trial, esc, message } = ctx;
  const ticker = ["Admissions", "Fees & receipts", "Attendance", "Exams & report cards", "Routine", "Parent app", "Teacher app", "Notices", "Leave", "Payroll", "School website", "Roles & permissions"];
  const tickerHtml = [...ticker, ...ticker].map((t) => `<span><i></i>${t}</span>`).join("");
  const nav = `<nav class="nav" id="mk-nav" aria-label="Primary navigation"><div class="wrap"><a class="brand" href="/"><span class="mark">A</span><strong>Anekio</strong></a><div class="nav-end desktop-nav"><div class="navlinks"><a href="#product">Product</a><a href="#roles">For every role</a><a href="#solutions">Workflows</a><a href="#pricing" data-intent="pay">Pricing</a></div><div class="nav-actions"><a class="btn light" href="#start" data-intent="demo">Book a demo</a><a class="btn primary" href="#start" data-intent="trial">Start free trial</a></div></div><details class="mobile-nav"><summary aria-label="Open navigation">☰</summary><div class="mobile-nav-menu"><a href="#product">Product</a><a href="#roles">For every role</a><a href="#solutions">Workflows</a><a href="#pricing" data-intent="pay">Pricing</a><a href="#start" data-intent="demo">Book a demo</a><a href="#start" data-intent="trial">Start free trial</a></div></details></div></nav>`;

  const hero = `<section class="mk-hero">
    <div class="wrap mk-hero-grid">
      <div class="mk-hero-copy">
        <span class="mk-chip"><b>✓</b> Web + Android · built for Indian schools</span>
        <h1>Run your whole school from <span class="mk-grad">one record.</span></h1>
        <p class="lead">Admissions, fees, attendance, exams, routine, notices and the parent app — every team works on the same student file, so nothing is retyped and nobody chases.</p>
        <div class="cta"><a class="btn primary" href="#start" data-intent="trial">Start ${trial}-day free trial</a><a class="btn ghost" href="#start" data-intent="demo">Book a 20-min demo</a></div>
        <div class="mk-hero-note"><span>No card needed</span><span>Setup help included</span><span>Your data, your school</span></div>
        ${message ? `<p class="mk-msg">${esc(message)}</p>` : ""}
      </div>
      <div class="mk-stage" data-parallax aria-label="Anekio on web and Android">
        ${window_("office-dashboard", "Anekio office dashboard: timetable gaps, idle staff, fees overdue and collection trend", "Office · Admin desk", "", true)}
        ${phone("01-parent-home", "Anekio parent app home showing attendance, last result and fees due", "a", true)}
        ${phone("05-teacher-attendance", "Anekio teacher app marking class attendance", "b")}
      </div>
    </div>
    <div class="mk-ticker" aria-hidden="true"><div class="mk-ticker-track">${tickerHtml}</div></div>
  </section>`;

  const stats = `<section class="wrap" aria-label="What Anekio covers">
    <div class="mk-stats" data-reveal-group>
      <div class="mk-stat"><b data-count="12" data-suffix="+">0</b><span>modules on one school record</span></div>
      <div class="mk-stat"><b data-count="4">0</b><span>portals: office, teacher, parent, student</span></div>
      <div class="mk-stat"><b data-count="60" data-suffix="s">0</b><span>to mark a whole class present</span></div>
      <div class="mk-stat"><b data-count="${trial}">0</b><span>free days, then ₹${ctx.sale} / ${esc(ctx.period)}</span></div>
    </div>
  </section>`;

  const product = `<section id="product" class="mk-section">
    <div class="wrap">
      <div class="center" data-reveal><span class="eyebrow">One platform</span><h2 class="section-title">Capture once. Use everywhere.</h2><p class="lead">A student is admitted once. From then on fees, attendance, marks, documents and messages stay attached to that same record — on the office web portal and on every phone.</p></div>
      <div class="mk-flow" data-reveal-group>
        <article><span class="n">1</span><strong>Admit the student</strong><p>The admission form becomes the working student file: class, parent, documents and billing month.</p></article>
        <article><span class="n">2</span><strong>Every team works on it</strong><p>Fees, attendance, exams, routine and notices read and write the same record. No spreadsheets in between.</p></article>
        <article><span class="n">3</span><strong>Each role sees what it needs</strong><p>Office gets control, teachers get their classes, parents get their child — with roles you decide.</p></article>
      </div>
    </div>
  </section>`;

  const rolePanel = (role: "office" | "teacher" | "parent", h: string, p: string, points: string[], shots: string[]) => {
    const list = points.map((x) => `<li>${x}</li>`).join("");
    const figs = shots
      .map((f) => {
        const meta = PHONE_SHOTS.find((s) => s.file === f);
        return `<figure class="mk-phone"><div class="mk-phone-shell"><span class="mk-phone-cam"></span>${img(f, esc(meta?.title || f))}</div><figcaption>${esc(meta?.title || "")}</figcaption></figure>`;
      })
      .join("");
    return { copy: `<div class="mk-role-panel" data-role-panel="${role}"${role === "office" ? "" : " hidden"}><h3>${h}</h3><p>${p}</p><ul class="mk-points">${list}</ul></div>`, shots: `<div class="mk-role-shots" data-role-shots="${role}"${role === "office" ? "" : " hidden"}>${figs}</div>` };
  };
  const office = rolePanel("office", "The office sees the whole day before it starts.", "Timetable gaps, absent teachers, overdue fees and today's registers — on one desk. Collect a fee in four taps and the receipt reaches the parent.", ["Fees register, UPI / cash / pay-link collection, auto receipts", "Attendance overview across every class by 10 AM", "Notices to parents, teachers or students with a preview", "Roles & permissions, area by area"], ["08-office-fees-register", "12-office-dashboard-cover", "19-office-attendance-overview"]);
  const teacher = rolePanel("teacher", "Teachers lose the paperwork, not the control.", "Mark a class present in under a minute, see today's periods, hand over question papers and enter marks — all from the phone in their pocket.", ["Attendance with P / L / A per student and a month register", "Own timetable with recess and rooms", "Question-paper handover and marks entry with deadlines", "Apply for leave; balance and approver shown"], ["05-teacher-attendance", "06-teacher-timetable", "04-teacher-apply-leave"]);
  const parent = rolePanel("parent", "Parents get answers without calling the school.", "Attendance, fees due, exam results and notices for each child — plus a numbered request thread so a question never gets lost on WhatsApp.", ["Fees due with Pay now and downloadable receipts", "Subject-wise marks and the report card", "Attendance calendar; switch between children", "Message the office or the class teacher"], ["01-parent-home", "17-parent-exam-result", "02-parent-message-school"]);

  const roles = `<section id="roles" class="mk-section mk-roles">
    <div class="wrap">
      <div data-reveal><span class="eyebrow">For every role</span><h2 class="section-title">One school. Every role. Same truth.</h2><p class="lead">Switch the role to see the same school from a different seat — these are real screens from the product.</p></div>
      <div class="mk-role-grid">
        <div data-reveal="left">
          <div class="mk-tabs" role="tablist" aria-label="Anekio portals">
            <button class="mk-tab" type="button" role="tab" aria-selected="true" data-role-tab="office">Office</button>
            <button class="mk-tab" type="button" role="tab" aria-selected="false" data-role-tab="teacher">Teacher</button>
            <button class="mk-tab" type="button" role="tab" aria-selected="false" data-role-tab="parent">Parent</button>
          </div>
          ${office.copy}${teacher.copy}${parent.copy}
        </div>
        <div data-reveal="right">${office.shots}${teacher.shots}${parent.shots}</div>
      </div>
    </div>
  </section>`;

  const show = (opts: { reverse?: boolean; eyebrow: string; h: string; p: string; points: string[]; shot: string; alt: string; title: string; over?: string }) => `<article class="mk-show${opts.reverse ? " is-reverse" : ""}">
      <div class="mk-show-copy" data-reveal="${opts.reverse ? "right" : "left"}"><span class="eyebrow">${opts.eyebrow}</span><h3>${opts.h}</h3><p>${opts.p}</p><ul class="mk-points">${opts.points.map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div class="mk-show-visual" data-reveal="${opts.reverse ? "left" : "right"}"><span class="mk-glow"></span>${window_(opts.shot, opts.alt, opts.title)}${opts.over ? phone(opts.over, "Anekio Android app", "over") : ""}</div>
    </article>`;

  const solutions = `<section id="solutions" class="mk-section" style="padding-top:clamp(56px,7vw,96px)">
    <div class="wrap">
      <div class="center" data-reveal><span class="eyebrow">Real school workflows</span><h2 class="section-title">Built around how a school actually runs.</h2><p class="lead">Not a generic ERP with a school skin. Each screen below is the live product.</p></div>
      ${show({ eyebrow: "Fees & collections", h: "From invoice to receipt without a single register.", p: "Class fee structures, late rules and add-ons issue invoices on their own. Collect in cash, UPI, pay link or bank; the receipt lands on the parent's phone with the school's stamp and signature.", points: ["Billed vs collected vs outstanding, by class", "Overdue list with who to call first", "Printable receipts with signature and stamp"], shot: "11-office-fees-report", alt: "Anekio fees report: billed, collected, outstanding and collection funnel", title: "Fees · Report", over: "10-office-collect-fee" })}
      ${show({ reverse: true, eyebrow: "Routine & timetable", h: "Drag a subject onto a period. Clashes stop themselves.", p: "The routine knows each teacher's load, which periods are free and what every class still needs. Drop a teacher into a slot they already teach elsewhere and it tells you exactly where.", points: ["Per-class and per-teacher views, export to PDF", "Auto-fill empty periods from curriculum targets", "Substitutions when a teacher is on leave"], shot: "14-office-routine-desktop-v2", alt: "Anekio routine builder with teachers on the left and the weekly grid", title: "Routine · 1-A" })}
      ${show({ eyebrow: "Receipts, report cards & documents", h: "Documents that look like they came from your school.", p: "Receipts, report cards, ID cards and admission letters print with your letterhead, stamp and signature — and reach parents as a download, not a photo of a register.", points: ["Fee receipts with stamp, signature and QR", "Report cards published once every mark is in", "Student ID cards and documents on file"], shot: "13-fee-receipt", alt: "Anekio printable fee receipt with school header, stamp and signature", title: "Print · Fee receipt", over: "17-parent-exam-result" })}
      ${show({ reverse: true, eyebrow: "Your school, online", h: "A school website with admissions built in.", p: "Every Anekio school gets a public website on its own address. Enquiries go straight into the admissions pipeline with follow-ups, calls and test schedules.", points: ["Admission enquiries land in the office inbox", "Parent app download links and notices", "Facilities, contact and campus pages"], shot: "16-school-website", alt: "Example school website generated by Anekio with admissions open banner", title: "Public website · anekio.school" })}
    </div>
  </section>`;

  const galleryItems = [...PHONE_SHOTS, ...PHONE_SHOTS]
    .map((s) => `<figure class="mk-phone"><div class="mk-phone-shell"><span class="mk-phone-cam"></span>${img(s.file, `${esc(s.title)} — ${esc(s.text)}`)}</div><figcaption><i class="${s.role}">${s.role}</i><b>${esc(s.title)}</b><span>${esc(s.text)}</span></figcaption></figure>`)
    .join("");
  const gallery = `<section class="mk-gallery" aria-label="Anekio Android app screens">
    <div class="wrap center" data-reveal><span class="eyebrow">Android app</span><h2 class="section-title">Everything above, in a pocket.</h2><p class="lead">One app, three roles. Parents, teachers and the office sign in to the same school and see their own view.</p></div>
    <div class="mk-gallery-track">${galleryItems}</div>
  </section>`;

  const bento = `<section class="mk-section" style="padding-top:0">
    <div class="wrap">
      <div class="center" data-reveal><span class="eyebrow">Everything, connected</span><h2 class="section-title">Modules that already know each other.</h2></div>
      <div class="mk-bento" data-reveal-group>
        <article class="wide"><span class="mk-ico">${ICONS.admissions}</span><h3>Admissions & students</h3><p>Leads, follow-ups, entrance tests and admission in one pipeline. Bulk import from Excel that follows your own admission form.</p></article>
        <article class="wide"><span class="mk-ico">${ICONS.fees}</span><span class="tag">UPI ready</span><h3>Fees, receipts & reminders</h3><p>Monthly invoices, late rules, discounts, pay links and auto reminders. School-owned payment gateway support.</p></article>
        <article><span class="mk-ico">${ICONS.attendance}</span><h3>Attendance</h3><p>Class register in a minute, teacher QR check-in, month view per student.</p></article>
        <article><span class="mk-ico">${ICONS.exams}</span><h3>Exams</h3><p>Dates and timings, paper handover, marks, publish once, report cards.</p></article>
        <article><span class="mk-ico">${ICONS.routine}</span><h3>Routine</h3><p>Drag-and-drop timetable with clash detection and PDF export.</p></article>
        <article><span class="mk-ico">${ICONS.parents}</span><h3>Parent inbox & notices</h3><p>Numbered request threads, circulars with preview, WhatsApp-friendly.</p></article>
        <article><span class="mk-ico">${ICONS.staff}</span><h3>Staff, leave & payroll</h3><p>Leave balances and approvals, salary payments with proof, onboarding forms.</p></article>
        <article><span class="mk-ico">${ICONS.roles}</span><h3>Roles & permissions</h3><p>Decide who can view or edit each area. Support login for Anekio staff is time-boxed.</p></article>
      </div>
    </div>
  </section>`;

  const compare = `<section id="why" class="mk-section" style="padding-top:0">
    <div class="wrap">
      <div class="center" data-reveal><span class="eyebrow">Why switch</span><h2 class="section-title">Registers and WhatsApp groups don't scale.</h2></div>
      <div class="mk-compare" data-reveal-group>
        <article class="old"><h3>Today</h3><small>Registers, Excel, calls</small><ul>
          <li><i>✕</i><div><b>Fees in a notebook</b>Who paid, who's overdue and how much is a half-day reconciliation.</div></li>
          <li><i>✕</i><div><b>Attendance on paper</b>The office finds out about absences at month end.</div></li>
          <li><i>✕</i><div><b>Results by photo</b>Marks typed twice, report cards made in Word.</div></li>
          <li><i>✕</i><div><b>Parents call the office</b>The same five questions, every day, to whoever picks up.</div></li>
        </ul></article>
        <article class="new"><h3>With Anekio</h3><small>One record, every role</small><ul>
          <li><i>✓</i><div><b>Fees reconcile themselves</b>Every receipt is attached to the student; the overdue list is live.</div></li>
          <li><i>✓</i><div><b>Attendance by 10 AM</b>Office sees which registers are done; parents see their child's day.</div></li>
          <li><i>✓</i><div><b>Marks entered once</b>Published to parents together, with a downloadable report card.</div></li>
          <li><i>✓</i><div><b>Answers on the phone</b>Fees, results and notices in the parent app; questions in a tracked thread.</div></li>
        </ul></article>
      </div>
      <div class="mk-india" data-reveal-group aria-label="Built for Indian schools">
        <span>🇮🇳 Built for Indian schools</span><span>₹ UPI, cash, pay links</span><span>📱 Android app for parents & teachers</span><span>🧾 Receipts with stamp & signature</span><span>🔐 Role-based access</span><span>🗓️ Academic sessions & CBSE-style exam plans</span>
      </div>
    </div>
  </section>`;

  return nav + `<main>` + hero + stats + product + roles + solutions + gallery + bento + compare;
}

export function marketingBottom(ctx: MarketingContext) {
  const { trial } = ctx;
  return `<section id="close" class="mk-section wrap" style="padding-top:0">
    <div class="mk-close" data-reveal>
      <span class="eyebrow">Bring the school together</span>
      <h2 class="section-title">Give every team one reliable place to work.</h2>
      <p class="lead">Start a ${trial}-day trial today, or see Anekio on your own school's data in a focused 20-minute demo.</p>
      <div class="cta"><a class="btn primary" href="#start" data-intent="trial">Start ${trial}-day free trial</a><a class="btn ghost" href="#start" data-intent="demo">Book a demo</a></div>
    </div>
  </section>
</main>
<footer><div class="wrap"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="/"><span class="mark">A</span><strong>Anekio</strong></a><p>School ERP for growing Indian schools. One platform, one school record, every team connected — on the web and on Android.</p></div><div class="footer-links"><a href="#product">Product</a><a href="#roles">For every role</a><a href="#solutions">Workflows</a><a href="#pricing" data-intent="pay">Pricing</a><a href="#start" data-intent="demo">Book a demo</a><a href="/privacy">Privacy</a><a href="mailto:support@anekio.com">support@anekio.com</a></div></div><div class="footer-base"><span>© ${new Date().getFullYear()} Anekio. All rights reserved.</span><span>Made in India</span></div></div></footer>`;
}

export function marketingScript() {
  return `<script>
  (function () {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Nav turns light once the dark hero scrolls away.
    var nav = document.getElementById("mk-nav");
    var hero = document.querySelector(".mk-hero");
    if (nav && hero && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        nav.classList.toggle("is-light", !entries[0].isIntersecting);
      }, { rootMargin: "-72px 0px 0px 0px", threshold: 0 }).observe(hero);
    }
    // Scroll reveal.
    var targets = document.querySelectorAll("[data-reveal],[data-reveal-group]");
    if ("IntersectionObserver" in window && !reduce) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      targets.forEach(function (t) { io.observe(t); });
    } else {
      targets.forEach(function (t) { t.classList.add("is-in"); });
    }
    // Counters.
    var counters = document.querySelectorAll("[data-count]");
    function runCount(el) {
      var end = Number(el.getAttribute("data-count")) || 0;
      var suffix = el.getAttribute("data-suffix") || "";
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / 1100);
        var v = Math.round(end * (1 - Math.pow(1 - p, 3)));
        el.innerHTML = String(v) + (suffix ? "<small>" + suffix + "</small>" : "");
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if ("IntersectionObserver" in window && !reduce) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { runCount(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      counters.forEach(function (c) { cio.observe(c); });
    } else {
      counters.forEach(function (c) { var sfx = c.getAttribute("data-suffix") || ""; c.innerHTML = c.getAttribute("data-count") + (sfx ? "<small>" + sfx + "</small>" : ""); });
    }
    // Hero parallax on pointer.
    var stage = document.querySelector(".mk-stage[data-parallax]");
    if (stage && !reduce && window.matchMedia("(pointer: fine)").matches) {
      var items = stage.children;
      hero.addEventListener("pointermove", function (ev) {
        var r = hero.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width - 0.5;
        var y = (ev.clientY - r.top) / r.height - 0.5;
        for (var i = 0; i < items.length; i++) {
          var depth = (i + 1) * 6;
          items[i].style.translate = (x * depth) + "px " + (y * depth) + "px";
        }
      });
      hero.addEventListener("pointerleave", function () { for (var i = 0; i < items.length; i++) items[i].style.translate = ""; });
    }
    // Role tabs: swap copy and phone screens.
    var tabs = document.querySelectorAll("[data-role-tab]");
    var panels = document.querySelectorAll("[data-role-panel]");
    var shots = document.querySelectorAll("[data-role-shots]");
    function showRole(role) {
      tabs.forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-role-tab") === role ? "true" : "false"); });
      panels.forEach(function (p) { if (p.getAttribute("data-role-panel") === role) p.removeAttribute("hidden"); else p.setAttribute("hidden", ""); });
      shots.forEach(function (s) {
        var on = s.getAttribute("data-role-shots") === role;
        var phones = s.querySelectorAll(".mk-phone");
        if (on) {
          s.removeAttribute("hidden");
          phones.forEach(function (p) { p.classList.remove("is-in"); });
          requestAnimationFrame(function () { requestAnimationFrame(function () { phones.forEach(function (p) { p.classList.add("is-in"); }); }); });
        } else { s.setAttribute("hidden", ""); }
      });
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { showRole(t.getAttribute("data-role-tab")); }); });
    showRole("office");
    // Auto-rotate roles until the user picks one.
    var roleOrder = ["office", "teacher", "parent"], roleIdx = 0, rolesSection = document.getElementById("roles"), userPicked = false;
    tabs.forEach(function (t) { t.addEventListener("click", function () { userPicked = true; }); });
    if (rolesSection && "IntersectionObserver" in window && !reduce) {
      var timer = null;
      new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !timer) {
          timer = setInterval(function () { if (userPicked) { clearInterval(timer); return; } roleIdx = (roleIdx + 1) % roleOrder.length; showRole(roleOrder[roleIdx]); }, 5000);
        } else if (!entries[0].isIntersecting && timer) { clearInterval(timer); timer = null; }
      }, { threshold: 0.4 }).observe(rolesSection);
    }
    document.querySelectorAll(".mobile-nav-menu a").forEach(function (link) {
      link.addEventListener("click", function () { var menu = link.closest("details"); if (menu) menu.removeAttribute("open"); });
    });
  })();
</script>`;
}
