/**
 * Anekio blog — server-rendered pages at /blog and /blog/:slug, styled with the marketing design system.
 * To publish a post: add an entry to POSTS (newest first). Body is trusted HTML written by the Anekio team.
 */
import { marketingCss, marketingFooter, marketingHead, marketingNav, marketingScript } from "./anekio-marketing";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  readMinutes: number;
  tag: string;
  body: string;
};

const SITE = (process.env.ANEKIO_PUBLIC_URL || "https://anekio.com").replace(/\/$/, "");

export const POSTS: BlogPost[] = [
  {
    slug: "how-to-choose-school-management-software-india",
    title: "How to choose school management software in India: a 12-point checklist",
    description: "What to check before you buy a school ERP in India — fees and UPI, parent app, attendance, exams, data ownership, support and pricing — with questions to ask in every demo.",
    date: "2026-11-01",
    readMinutes: 7,
    tag: "Buying guide",
    body: `
<p>Most schools start looking for software for one reason — usually fees — and end up buying a system that has to run everything else too. A good choice saves the office hours every day. A poor one means two systems, a register kept "just in case", and staff who quietly stop using it.</p>
<p>This checklist is what we would ask if we were buying school management software ourselves. Use it in every demo, whichever vendor you are talking to.</p>
<h2>1. Does every module share one student record?</h2>
<p>Ask the vendor to admit a test student, then show you that same student in fees, attendance, exams and the parent app — without typing anything again. If modules were bought or built separately, you will see duplicate forms and "sync" buttons. That is where errors come from.</p>
<h2>2. Can it handle your real fee structure?</h2>
<p>Indian schools rarely have one flat fee. Check for class-wise fee heads, monthly or quarterly billing, transport and add-ons, sibling or staff discounts, late fees with grace days, and concessions approved by the principal. Ask them to set up one of your actual classes during the demo.</p>
<h2>3. UPI, cash, cheque and pay links — all in one ledger</h2>
<p>Parents pay in every way possible. The system should record cash at the counter, UPI, bank transfer and online pay links against the same invoice, and issue a receipt instantly. Ask whether online payments settle into <em>your school's</em> own payment gateway account, and what the vendor charges on top.</p>
<h2>4. Receipts and report cards that look like your school</h2>
<p>Receipts, report cards and ID cards should carry your letterhead, logo, principal's signature and stamp. Parents notice when a document looks generic — and some boards and banks ask for properly formatted receipts.</p>
<h2>5. A parent app people actually open</h2>
<p>Check what a parent sees on day one: attendance, fees due with a Pay button, results, notices and a way to message the school. A parent app that only shows circulars gets uninstalled. Ask for the Android app on your own phone during the demo.</p>
<h2>6. Attendance that takes a teacher under a minute</h2>
<p>If marking attendance is slow, teachers go back to paper. Time it in the demo. Also check whether the office can see which classes have not marked attendance yet, and whether parents are informed of absences.</p>
<h2>7. Exams, marks and report cards for your board</h2>
<p>Whether you follow CBSE, ICSE or a state board, you need terms, subjects, grading and report card formats that match. Check that teachers can enter marks for their own subjects only, and that results are published to parents together, not leaked one by one.</p>
<h2>8. Roles and permissions</h2>
<p>The accountant should not edit marks, and a class teacher should not see every family's fee history. Ask how roles are set up and whether you can create your own.</p>
<h2>9. Who owns the data — and can you export it?</h2>
<p>Your student and fee data belongs to the school. Ask how you export everything to Excel, how often backups are taken, and what happens to your data if you stop using the product. A vendor that hesitates here is a warning sign.</p>
<h2>10. Setup help and training</h2>
<p>The first month decides whether software sticks. Ask who imports your existing student list, who sets up fee structures, and whether staff training is included or charged separately.</p>
<h2>11. Works on the devices you already have</h2>
<p>The office needs a web portal that runs in a normal browser. Teachers and parents mostly use Android phones, often mid-range ones on patchy networks. Check how the app behaves on a slower phone.</p>
<h2>12. Clear, predictable pricing</h2>
<p>Ask for the total yearly cost for your student count, including the parent app, SMS or WhatsApp messages, payment gateway charges, setup and support. Per-student pricing is common — make sure you know the minimum and what happens when admissions grow.</p>
<h2>Questions to ask in every demo</h2>
<ul>
<li>Can you set up one of our real classes and fee structures right now?</li>
<li>What will a parent see the first time they open the app?</li>
<li>How do we export all our data if we leave?</li>
<li>Who will help us import our students, and how long does it take?</li>
<li>What is the all-in yearly cost for our number of students?</li>
</ul>
<p>If you want to see how Anekio answers these, <a href="/#start" data-intent="demo">book a free 20-minute demo</a> and we'll walk through it with your own classes.</p>
`,
  },
  {
    slug: "collect-school-fees-online-upi",
    title: "Collecting school fees online with UPI: a practical guide for school offices",
    description: "How Indian schools can move fee collection to UPI and pay links without losing track of cash payments — setup, reminders, receipts and reconciliation.",
    date: "2026-10-28",
    readMinutes: 6,
    tag: "Fees",
    body: `
<p>Most parents already pay for groceries, electricity and phone recharges with UPI. Fees are often the last bill they still pay in cash at a counter. Moving fees online is not about the payment itself — it is about knowing, at any moment, who has paid and who has not.</p>
<h2>Start with clean invoices, not a QR code</h2>
<p>Sticking a UPI QR code on the office wall makes paying easy, but it makes reconciliation hard: money arrives with no student name attached. The better starting point is an invoice for each student and fee period. When a payment comes in against an invoice, the system knows exactly what it was for.</p>
<h2>Set up fee structures once</h2>
<p>Define fee heads (tuition, transport, activities), how often each is billed, due dates, and any late fee rules. Apply them by class, then handle exceptions — siblings, staff children, scholarships — as concessions on individual students. Done properly, invoices then generate themselves every month or term.</p>
<h2>Give parents a pay link, not just an account number</h2>
<p>A pay link sent to the parent's phone opens straight to the amount due, with UPI, cards and net banking. When the parent pays, the invoice is marked paid and a receipt is sent automatically. No one has to match a bank statement line to a student by hand.</p>
<h2>Keep cash and cheques in the same ledger</h2>
<p>Some parents will keep paying at the counter, and that is fine. The important thing is that the cashier records cash, cheque and bank transfers against the same invoices as online payments. One ledger means one overdue list everyone can trust.</p>
<h2>Remind politely, and on time</h2>
<p>Most late payments are forgotten, not refused. A short reminder a few days before the due date, and another after it, recovers a large share of dues without anyone making a phone call. Send reminders on WhatsApp or SMS with the pay link included, so paying takes one tap.</p>
<h2>Send a proper receipt every time</h2>
<p>Every payment — online or cash — should produce a receipt with the school's name, logo, student details, fee period, amount and payment method, ideally with a signature and stamp. Parents keep these for tax and reimbursement claims.</p>
<h2>Reconcile daily, not at month end</h2>
<p>At the end of each day, the office should be able to see total collected by payment method and match it with the cash in hand and the gateway settlement. Small differences are easy to fix the same day and very hard to trace a month later.</p>
<h2>A simple rollout plan</h2>
<ul>
<li><strong>Week 1:</strong> set up fee structures and import students with their current dues.</li>
<li><strong>Week 2:</strong> start issuing receipts from the system for every counter payment.</li>
<li><strong>Week 3:</strong> send pay links with the next fee reminder.</li>
<li><strong>Week 4:</strong> review the overdue list and follow up with the families who have not paid.</li>
</ul>
<p>Anekio's fees module does all of this on one student record — invoices, UPI and pay links, cash at the counter, receipts with your stamp and signature, and WhatsApp reminders. <a href="/#start" data-intent="demo">Book a free demo</a> to see it with your own fee structure.</p>
`,
  },
  {
    slug: "move-school-from-registers-to-erp",
    title: "Moving your school from registers and Excel to an ERP: a 30-day plan",
    description: "A week-by-week plan for switching a school from paper registers, Excel sheets and WhatsApp groups to a school ERP — without disrupting the term.",
    date: "2026-10-21",
    readMinutes: 6,
    tag: "Getting started",
    body: `
<p>The hardest part of school software is not choosing it — it is the first month of using it. Staff are busy, the term is running, and the old registers still work well enough. This plan keeps the switch small and steady, so nothing breaks while you move.</p>
<h2>Before you start: pick one owner</h2>
<p>Choose one person in the office — often the administrator or senior accountant — who owns the rollout. They do not have to do everything, but every question goes through them. Schools that skip this step usually end up with half the staff on the new system and half on paper.</p>
<h2>Week 1: school basics and students</h2>
<ul>
<li>Enter school details, academic session, classes and sections.</li>
<li>Set bell times and the school calendar, including holidays.</li>
<li>Import students and parents from your existing Excel sheet. Clean it first: one row per student, consistent class names, a working phone number for each parent.</li>
</ul>
<h2>Week 2: fees</h2>
<ul>
<li>Set up fee heads and structures for each class.</li>
<li>Enter each student's opening balance, so dues carry over correctly.</li>
<li>From this week, every receipt at the counter is issued from the system — no exceptions. Keep the old register only for reference.</li>
</ul>
<h2>Week 3: teachers and attendance</h2>
<ul>
<li>Add staff and give each teacher their classes and subjects.</li>
<li>Show teachers how to mark attendance on their phone — it takes five minutes in a staff meeting.</li>
<li>Have the office check every morning which classes have marked attendance, and nudge the rest.</li>
</ul>
<h2>Week 4: parents</h2>
<ul>
<li>Send parents the app link with a short note from the principal.</li>
<li>Publish the next circular through the app instead of a WhatsApp group.</li>
<li>Send the next fee reminder with a pay link.</li>
</ul>
<h2>After 30 days</h2>
<p>By now fees, attendance and parent communication run on one system. Exams and report cards can follow at the next term, when teachers set up subjects and marks entry. Routine and timetables can come any time the office is ready.</p>
<h2>Common mistakes to avoid</h2>
<ul>
<li><strong>Running two systems "for safety".</strong> Set a date after which the paper register is not updated.</li>
<li><strong>Importing messy data.</strong> Thirty minutes cleaning the Excel sheet saves days of corrections later.</li>
<li><strong>Training everyone at once.</strong> Office first, then teachers, then parents.</li>
<li><strong>Skipping opening balances.</strong> Without them, the first overdue list is wrong and staff lose trust in it.</li>
</ul>
<p>Anekio includes a guided setup checklist that follows this order and checks each step against your real data, plus setup help from our team. <a href="/#start" data-intent="demo">Book a demo</a> to walk through it with your own school.</p>
`,
  },
];

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function niceDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const BLOG_CSS = `<style>
html{scroll-behavior:smooth}body.blog-page{margin:0;line-height:1.5}body.blog-page a{color:inherit;text-decoration:none}body.blog-page img{max-width:100%}
body.blog-page .blog-hero{padding:clamp(56px,8vw,104px) 0 clamp(32px,4vw,48px);border-bottom:1px solid var(--line)}
body.blog-page .blog-hero h1{font-size:clamp(36px,5vw,60px);line-height:1.02;letter-spacing:-.045em;margin:14px 0 14px;max-width:18ch}
body.blog-page .blog-list{display:grid;gap:0;padding:16px 0 clamp(64px,8vw,104px)}
body.blog-page .blog-item{display:grid;grid-template-columns:180px 1fr;gap:32px;padding:32px 0;border-bottom:1px solid var(--line)}
body.blog-page .blog-item time,body.blog-page .blog-meta{font-size:14px;color:var(--muted)}
body.blog-page .blog-item h2{font-size:clamp(22px,2.2vw,28px);line-height:1.2;letter-spacing:-.03em;margin:8px 0 10px}
body.blog-page .blog-item h2 a:hover{color:var(--brand)}
body.blog-page .blog-item p{margin:0 0 14px;color:var(--muted);font-size:16px;line-height:1.6;max-width:64ch}
body.blog-page .blog-tag{display:inline-block;font-size:12px;font-weight:600;color:var(--brand);background:#eef3ff;border-radius:999px;padding:3px 10px}
body.blog-page .post{max-width:720px;margin:0 auto;padding:clamp(48px,7vw,88px) 0 clamp(56px,8vw,96px)}
body.blog-page .post-back{display:flex;width:max-content;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--muted);margin-bottom:28px}
body.blog-page .post-back:hover{color:var(--ink)}
body.blog-page .post h1{font-size:clamp(32px,4.4vw,52px);line-height:1.05;letter-spacing:-.045em;margin:16px 0 16px}
body.blog-page .post .blog-meta{display:flex;gap:8px;flex-wrap:wrap;padding-bottom:28px;margin-bottom:8px;border-bottom:1px solid var(--line)}
body.blog-page .post-body{font-size:17px;line-height:1.75;color:var(--ink-2)}
body.blog-page .post-body h2{font-size:24px;line-height:1.25;letter-spacing:-.03em;color:var(--ink);margin:44px 0 12px}
body.blog-page .post-body p{margin:0 0 18px}
body.blog-page .post-body ul{margin:0 0 20px;padding-left:22px}
body.blog-page .post-body li{margin:6px 0}
body.blog-page .post-body a{color:var(--brand);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
body.blog-page .post-body strong{color:var(--ink);font-weight:600}
body.blog-page .post-cta{margin-top:56px;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--soft);display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
body.blog-page .post-cta b{display:block;font-size:19px;letter-spacing:-.02em}
body.blog-page .post-cta span{display:block;color:var(--muted);font-size:15px;margin-top:4px}
body.blog-page .post-cta .cta{display:flex;gap:10px;flex-wrap:wrap}
body.blog-page .post-more{margin-top:56px}
body.blog-page .post-more h3{font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0;margin:0 0 8px}
body.blog-page .post-more a{display:block;padding:14px 0;border-top:1px solid var(--line);font-weight:500;font-size:16px;color:var(--ink)}
body.blog-page .post-more a:hover{color:var(--brand)}
@media(max-width:768px){body.blog-page .blog-item{grid-template-columns:1fr;gap:6px}body.blog-page .post-cta{padding:24px}}
</style>`;

function page(opts: { title: string; description: string; path: string; body: string; jsonLd: unknown; ogType?: string }) {
  const url = `${SITE}${opts.path}`;
  return `<!doctype html>
<html lang="en-IN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${esc(url)}" />
  <link rel="alternate" type="application/rss+xml" title="Anekio blog" href="${SITE}/blog/rss.xml" />
  <meta property="og:type" content="${opts.ogType || "website"}" />
  <meta property="og:title" content="${esc(opts.title)}" />
  <meta property="og:description" content="${esc(opts.description)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${marketingHead()}${marketingCss()}${BLOG_CSS}
  <script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body class="marketing-page blog-page">
${marketingNav("/", true)}
<main>${opts.body}</main>
<div class="mk-end">${marketingFooter("/")}</div>
${marketingScript()}
</body>
</html>`;
}

export function blogIndexHtml() {
  const items = POSTS.map(
    (p) => `<article class="blog-item"><div><time datetime="${p.date}">${niceDate(p.date)}</time></div><div><span class="blog-tag">${esc(p.tag)}</span><h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p>${esc(p.description)}</p><a class="mk-link" href="/blog/${p.slug}">Read article <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></article>`
  ).join("");
  return page({
    title: "Blog — school management, fees and ERP guides | Anekio",
    description: "Practical guides for Indian school owners, principals and office teams: choosing school management software, online fee collection, attendance, exams and going digital.",
    path: "/blog",
    body: `<section class="blog-hero"><div class="wrap"><span class="eyebrow">Anekio blog</span><h1>Guides for running a school, better.</h1><p class="lead">Practical advice for school owners, principals and office teams in India — fees, attendance, exams, parents and going digital.</p></div></section><section class="wrap blog-list">${items}</section>`,
    jsonLd: { "@context": "https://schema.org", "@type": "Blog", name: "Anekio blog", url: `${SITE}/blog`, publisher: { "@type": "Organization", name: "Anekio", url: SITE } },
  });
}

export function blogPostHtml(slug: string) {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return null;
  const more = POSTS.filter((p) => p.slug !== slug).slice(0, 3);
  const body = `<article class="wrap post">
    <a class="post-back" href="/blog"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>All articles</a>
    <span class="blog-tag">${esc(post.tag)}</span>
    <h1>${esc(post.title)}</h1>
    <div class="blog-meta"><span>Anekio team</span><span>·</span><time datetime="${post.date}">${niceDate(post.date)}</time><span>·</span><span>${post.readMinutes} min read</span></div>
    <div class="post-body">${post.body}</div>
    <div class="post-cta"><div><b>See it with your own school's data</b><span>Free 20-minute online demo. Our team sets up your school for you.</span></div><div class="cta"><a class="btn primary" href="/#start" data-intent="demo">Book a free demo</a><a class="btn light" href="/#pricing" data-intent="pay">See pricing</a></div></div>
    ${more.length ? `<nav class="post-more" aria-label="More articles"><h3>Keep reading</h3>${more.map((m) => `<a href="/blog/${m.slug}">${esc(m.title)}</a>`).join("")}</nav>` : ""}
  </article>`;
  return page({
    title: `${post.title} | Anekio`,
    description: post.description,
    path: `/blog/${post.slug}`,
    ogType: "article",
    body,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: `${SITE}/blog/${post.slug}`,
      image: `${SITE}/demo/og-anekio.png`,
      author: { "@type": "Organization", name: "Anekio" },
      publisher: { "@type": "Organization", name: "Anekio", logo: { "@type": "ImageObject", url: `${SITE}/demo/anekio-mark.svg` } },
    },
  });
}

export function blogRssXml() {
  const items = POSTS.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE}/blog/${p.slug}</link><guid>${SITE}/blog/${p.slug}</guid><pubDate>${new Date(`${p.date}T00:00:00Z`).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Anekio blog</title><link>${SITE}/blog</link><description>Guides for running a school in India.</description><language>en-in</language>${items}</channel></rss>`;
}

/** Paths for the sitemap. */
export function blogSitemapPaths() {
  return ["/blog", ...POSTS.map((p) => `/blog/${p.slug}`)];
}
