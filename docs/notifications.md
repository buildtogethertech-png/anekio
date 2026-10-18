# Notifications — what arrives in the bell, and why

Every notification is a row in the `Notice` table. The bell (desktop popover, phone `/notifications` page) shows the
notices the signed-in user can see, newest first (`noticesForUser` in `lib/data.ts`). Most also go out as an Expo push
to the user's phone (`lib/push.ts`) and some as email/WhatsApp through the SaaS mailer.

**Who sees a notice**

- **Exact recipients** (`NoticeRecipient` rows) — only those users see it, whatever their portal.
- **Audience notices** (no recipients) — everyone in the listed portals, narrowed by class (`NoticeClass`) and, for
  parents/students, by `studentId`.

**How a tap opens the right screen** — `hrefForNotice` in `mobile/lib/notice-kind.ts` looks at `kind` and `eventKey`.

| kind | Label | Icon | Opens |
|---|---|---|---|
| `CIRCULAR` | School | megaphone | Notices page |
| `ADMISSION` | Admissions | school | Admissions |
| `EXAM` | Examination | ribbon | Exams, deep-linked to the paper / marks view by `eventKey` |
| `FEES` | Fees | wallet | Fees |
| `FEEDBACK` | Feedback | chat bubble | Inbox |
| `INBOX` | Messages | chat bubbles | Inbox, opened on the thread (`eventKey = INBOX:<threadId>:<time>`) |
| `ATTENDANCE` | Attendance | calendar | Attendance (or Leave when the text mentions leave) |
| `LEAVE` | Leave | airplane | Leave / Staff |

The Notices page itself lists only `CIRCULAR` notices (`isCircularNotice`). Everything else is bell-only.

---

## 1. Messages (inbox) — `kind: INBOX`  · `lib/inbox.ts`

One notification per message, to every other member of the thread (never to the author). Push + bell. Tapping opens
that thread.

| Trigger | Who gets it | Title |
|---|---|---|
| Parent starts a thread (office / class teacher / a subject teacher) | the office inbox users, or the chosen teacher | `<child>'s parent: <subject>` |
| Any reply (parent or staff) | other members of the thread | `<subject>` |
| Staff internal note | staff members only (not the parent) | `Note · <subject>` |
| Staff added to a thread | the added staff | `You were added · <subject>` |

## 2. Parent ↔ school feedback — `kind: FEEDBACK` · `lib/core-actions.ts`

Older "query" flow that sits alongside the inbox.

| Trigger | Who | Title |
|---|---|---|
| Parent raises a query / consult | office (query) or the teacher (consult) | `Parent query: <subject>` / `Parent consult: <subject>` |
| Someone @mentions a staff member in a thread | the mentioned user | `Mentioned in <subject>` |
| Teacher sends a class note about one student | the student's parent | `<title>` or `Note · <student>` |

## 3. Circulars — `kind: CIRCULAR` · `publishNoticeCore`

The office sends a notice to Parents / Teachers / Students / Office staff, optionally per class. Audience notice; shows
in the bell **and** on the Notices page; push to everyone it reaches (`notifyNoticePublished`).

## 4. Admissions — `kind: ADMISSION`

| Trigger | Who | Title | Where |
|---|---|---|---|
| Website enquiry form submitted | office | `New admission enquiry: <student / guardian>` | `lib/school-website.ts` |
| Walk-in lead added | office | `Walk-in lead added` | `lib/core-actions.ts` |
| Lead admitted | office | `Student admitted` | `lib/core-actions.ts` |
| Follow-up due (generated when the office opens the bell) | office | `Follow up admission lead: <student>` | `ensureDueAdmissionFollowUpNotices`, `lib/data.ts` |

## 5. Fees — `kind: FEES`

| Trigger | Who | Title |
|---|---|---|
| Admit card blocked because fees are pending (document studio) | the parent | `Admit card blocked — fees pending` |
| Report card held because fees are pending | the parent | `Report card held — fees pending` |
| One-time admission fee invoice raised at admission | the parent | `One-time admission fee` |

Fee *due reminders* go by push/WhatsApp from the Fees module (`sendDueReminder`), not as bell notices.

## 6. Exams — `kind: EXAM` · `lib/exam-events.ts`, `lib/exam-schedule-all.ts`, `lib/exam-notification-run.ts`

All exact-recipient. Each has a unique `eventKey` so the same event is never sent twice.

**When the office schedules / edits an exam**

| Trigger | Who | Title |
|---|---|---|
| Exam scheduled for a class (per teacher digest) | each teacher with papers | `<exam> scheduled · N papers for you` |
| Paper setter / checker changed | new teacher | `<exam> · you now <set/check> for <subject class>` |
| Paper setter / checker changed | old teacher | `<exam> · <subject class> moved to <new teacher>` |
| Single paper added | the subject teacher | `<exam> · <class>` ("… added <subject> for <class> on <date>") |
| Exam assigned to a teacher | teacher | `Exam assigned: <subject>` |
| Schedule published to families | parents & students of the classes | `<exam> examination schedule published` |

**Question paper**

| Trigger | Who | Title |
|---|---|---|
| Teacher uploads / prepares the paper | office exam staff | `Question paper prepared: <subject>` |
| Teacher hands the paper over | office exam staff | `Paper handed over: <subject>` |
| Office confirms receipt | the setter | `Office received your <subject> paper` |
| Office sends the paper back | the setter | `<subject> paper sent back` |
| Cron: paper due today | setter | `Question paper due today: <subject>` |
| Cron: paper overdue (NT-5) | setter + office | overdue reminder |

**Exam day**

| Trigger | Who | Title |
|---|---|---|
| Cron: day before | teacher, parents, students | `Exam tomorrow: <subject>` |
| Cron: morning of | teacher, parents, students | `Exam today: <subject>` |
| Teacher marks the exam as conducted | office | `Exam conducted: <subject>` |

**Marks & results**

| Trigger | Who | Title |
|---|---|---|
| Marks entry window opens | checker | `Marks entry open: <subject>` |
| Office allows late entry | checker | `Marks entry allowed: <subject>` |
| Marks reminder (cron) | checker | `Marks reminder: <subject>` |
| Office approves marks | checker | `Marks approved: <subject>` |
| Office asks for a correction | checker | `Marks correction required: <subject>` |
| Every paper in the class has marks | office | `<exam> ready to publish` |
| Cron: result publication due | office | `Result publication due: <subject>` |
| Results published | parents & students of the class | `<exam> results are out` / `<exam sitting> results are out` |
| Report cards generated | parents | `<exam> report card` / `<exam> report cards ready` |
| Published marks edited afterwards (audit) | office + the parent | `Published marks changed · <subject> <class>` |

## 7. Leave — `kind: LEAVE` / `ATTENDANCE` · `lib/leave-actions.ts`, `lib/leave.ts`

| Trigger | Who | Title |
|---|---|---|
| Staff applies for leave | approver (reporting manager / office) | `Leave request · <name>` |
| Leave auto-approved (no manager) | office | `On leave · <teacher>` |
| Parent applies leave for a child | class teacher | `Leave waiting · <child>` |
| Teacher forwards a child's leave to the parent | parent | `Waiting on you · <child>` |
| Staff leave approved | the applicant | `Leave approved` / `Leave approved · <name>` |
| Staff leave rejected | the applicant | `Leave not approved` / `Leave rejected · <name>` |
| Child's leave granted | parent & student | `Leave granted · <child>` |
| Child's leave declined | parent & student | `Leave declined · <child>` |
| Office / substitute assigned for a teacher on leave | the substitute | via `assignSubstituteCore` |

## 8. Teacher to-dos (not notices)

"Set <subject> paper", "<subject> paper set", "Exam taken · <subject>", "Marks sent · <subject>" appear on the teacher
**home to-do list** (`lib/data.ts` markSheets), not in the bell.

---

### Adding a new notification

1. Create a `Notice` with a `kind` from `NOTICE_KINDS` (`lib/notices.ts` and `mobile/lib/notice-kind.ts` must match),
   a unique `eventKey` when the event can fire twice, and either `recipients` or `audiences`.
2. Call `notifyNoticeRecipients` (exact) or `notifyNoticePublished` (audience) for the push.
3. If a tap should open a specific screen, encode the id in `eventKey` and handle it in `hrefForNotice`.
4. Add the row to this file.
