import {
  AttendanceStatus,
  FeeLineKind,
  InvoiceStatus,
  PathTag,
  PrismaClient,
  RoomKind,
  StaffKind,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_EXAM_PLAN } from "../lib/exams";
import { defaultGrants, SYSTEM_ROLES } from "../lib/permissions";
import { seedSaasEmailDefaults } from "../lib/saas-email";
import { seedExamDemo } from "./seed-exams";

const prisma = new PrismaClient();
const PASSWORD = "12345";

type LoginRow = { role: string; name: string; email: string; password: string; phone: string; detail: string };

const FAMILIES: {
  grade: string;
  teacher: { name: string; email: string; employeeId: string; qualification: string };
  parents: { name: string; kids: [string, string] }[];
}[] = [
  {
    grade: "1",
    teacher: { name: "Kavita Joshi", email: "kavita.joshi@school.test", employeeId: "T-201", qualification: "B.Ed — Class 1" },
    parents: [
      { name: "Meera Sharma", kids: ["Aisha Sharma", "Rohan Sharma"] },
      { name: "Anita Kapoor", kids: ["Diya Kapoor", "Arjun Kapoor"] },
      { name: "Tapas Sen", kids: ["Myra Sen", "Kabir Sen"] },
      { name: "Nisha Rao", kids: ["Advait Rao", "Tanvi Rao"] },
      { name: "Amit Das", kids: ["Kiara Das", "Vihaan Das"] },
    ],
  },
  {
    grade: "2",
    teacher: { name: "Sandeep Gill", email: "sandeep.gill@school.test", employeeId: "T-202", qualification: "M.Sc · B.Ed — Class 2" },
    parents: [
      { name: "Suresh Menon", kids: ["Aanya Menon", "Dev Menon"] },
      { name: "Farah Qureshi", kids: ["Zara Qureshi", "Ali Qureshi"] },
      { name: "Deepak Nair", kids: ["Devika Nair", "Yash Nair"] },
      { name: "Anjali Bose", kids: ["Anika Bose", "Reyansh Bose"] },
      { name: "Imran Sheikh", kids: ["Sara Sheikh", "Neel Sheikh"] },
    ],
  },
  {
    grade: "3",
    teacher: { name: "Rhea DSouza", email: "rhea.dsouza@school.test", employeeId: "T-203", qualification: "B.Ed — Class 3" },
    parents: [
      { name: "Lakshmi Iyer", kids: ["Ananya Iyer", "Karthik Iyer"] },
      { name: "Rohan Kapoor", kids: ["Ira Kapoor", "Vivaan Kapoor"] },
      { name: "Priya Nair", kids: ["Maya Nair", "Aarav Nair"] },
      { name: "Sameer Khan", kids: ["Hana Khan", "Omar Khan"] },
      { name: "Kavita Reddy", kids: ["Sana Reddy", "Aditya Reddy"] },
    ],
  },
  {
    grade: "4",
    teacher: { name: "Manoj Pillai", email: "manoj.pillai@school.test", employeeId: "T-204", qualification: "M.P.Ed · B.Ed — Class 4" },
    parents: [
      { name: "Leena Shah", kids: ["Ishaan Shah", "Riya Shah"] },
      { name: "Harshad Rao", kids: ["Anvi Rao", "Kabir Rao"] },
      { name: "Neha Joshi", kids: ["Tisha Joshi", "Arnav Joshi"] },
      { name: "Farhan Sheikh", kids: ["Ayaan Sheikh", "Inaaya Sheikh"] },
      { name: "Pooja Mehta", kids: ["Kiara Mehta", "Riaan Mehta"] },
    ],
  },
  {
    grade: "5",
    teacher: { name: "Shalini Gupta", email: "shalini.gupta@school.test", employeeId: "T-205", qualification: "M.A · CTET — Class 5" },
    parents: [
      { name: "Anand Verma", kids: ["Diya Verma", "Harsh Verma"] },
      { name: "Sneha Patil", kids: ["Avni Patil", "Yash Patil"] },
      { name: "Mohit Mehta", kids: ["Mira Mehta", "Veer Mehta"] },
      { name: "Ayesha Ali", kids: ["Noor Ali", "Zayan Ali"] },
      { name: "Rahul Bose", kids: ["Tara Bose", "Arjun Bose"] },
    ],
  },
];

function writeLoginSheet(rows: LoginRow[]) {
  const jsonPath = join(process.cwd(), "Anekio-demo-logins.json");
  const grouped = {
    password: PASSWORD,
    note: "Every login uses password 12345. Parents, teachers, and staff also have a mobile. Students do not.",
    office: rows.filter((r) => r.role === "Office"),
    teachers: rows.filter((r) => r.role === "Teacher"),
    parents: rows.filter((r) => r.role === "Parent"),
    students: rows.filter((r) => r.role === "Student"),
    staff: rows.filter((r) => r.role === "Staff"),
  };
  writeFileSync(jsonPath, JSON.stringify(grouped, null, 2) + "\n", "utf8");

  const header = ["Role", "Name", "Email", "Password", "Mobile", "Detail"];
  const csv = [header.join(","), ...rows.map((r) => [r.role, r.name, r.email, r.password, r.phone, r.detail].map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\n");
  const csvPath = join(process.cwd(), "Anekio-demo-logins.csv");
  writeFileSync(csvPath, `${csv}\n`, "utf8");
  return { jsonPath, csvPath };
}

async function main() {
  // Keep platform mail inert in demo/local data: defaults have no Resend key and remain disabled.
  await seedSaasEmailDefaults(prisma);
  await prisma.timetableSlot.deleteMany();
  await prisma.teacherSkill.deleteMany();
  await prisma.teacherClass.deleteMany();
  await prisma.period.deleteMany();
  await prisma.room.deleteMany();
  await prisma.schoolConfig.deleteMany();
  await prisma.schoolHoliday.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveType.deleteMany();
  await prisma.application.deleteMany();
  await prisma.noticeAudience.deleteMany();
  await prisma.noticeClass.deleteMany();
  await prisma.notice.deleteMany();
  await prisma.grant.deleteMany();
  await prisma.contestEntry.deleteMany();
  await prisma.contest.deleteMany();
  await prisma.examPaper.deleteMany();
  await prisma.examResult.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.examSeries.deleteMany();
  await prisma.feeReminder.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.feeInvoice.deleteMany();
  await prisma.feeLine.deleteMany();
  await prisma.feeTemplate.deleteMany();
  await prisma.schoolSession.deleteMany();
  await prisma.staffDay.deleteMany();
  await prisma.staffMember.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.studentInterest.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.student.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.class.deleteMany();
  await prisma.user.deleteMany();
  await prisma.roleGrant.deleteMany();
  await prisma.role.deleteMany();

  const roleIds: Record<string, string> = {};
  for (const spec of SYSTEM_ROLES) {
    const role = await prisma.role.create({
      data: {
        name: spec.name,
        slug: spec.slug,
        portal: spec.portal,
        description: spec.description,
        isSystem: true,
        grants: { create: defaultGrants(spec.slug).map((permission) => ({ permission })) },
      },
    });
    roleIds[spec.slug] = role.id;
  }

  const pass = await bcrypt.hash(PASSWORD, 10);
  const logins: LoginRow[] = [];
  let phoneN = 1;
  const nextPhone = () => `98${String(phoneN++).padStart(8, "0")}`;

  const office = [
    { email: "admin@school.test", name: "Vikram Rao", roleId: roleIds.ADMIN, detail: "Admin — everything" },
    { email: "fees@school.test", name: "Ritu Shah", roleId: roleIds.FEES, detail: "Fees — collector" },
    { email: "exams@school.test", name: "Kiran Mehta", roleId: roleIds.EXAMS, detail: "Exams — controller" },
  ];
  for (const row of office) {
    const phone = nextPhone();
    await prisma.user.create({ data: { email: row.email, password: pass, name: row.name, roleId: row.roleId, phone } });
    logins.push({ role: "Office", name: row.name, email: row.email, password: PASSWORD, phone, detail: row.detail });
  }

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin@school.test" } });

  const session = await prisma.schoolSession.create({
    data: {
      label: "2026–27",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      current: true,
      examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN),
    },
  });

  const periodDefs = [
    { name: "Period 1", startsAt: "09:00", endsAt: "09:40", sortOrder: 1, isBreak: false },
    { name: "Period 2", startsAt: "09:40", endsAt: "10:20", sortOrder: 2, isBreak: false },
    { name: "Period 3", startsAt: "10:20", endsAt: "11:00", sortOrder: 3, isBreak: false },
    { name: "Recess", startsAt: "11:00", endsAt: "11:20", sortOrder: 4, isBreak: true },
    { name: "Period 4", startsAt: "11:20", endsAt: "12:00", sortOrder: 5, isBreak: false },
    { name: "Period 5", startsAt: "12:00", endsAt: "12:40", sortOrder: 6, isBreak: false },
    { name: "Period 6", startsAt: "12:40", endsAt: "13:20", sortOrder: 7, isBreak: false },
    { name: "Period 7", startsAt: "13:50", endsAt: "14:30", sortOrder: 8, isBreak: false },
    { name: "Period 8", startsAt: "14:30", endsAt: "15:10", sortOrder: 9, isBreak: false },
  ];
  const periods = [];
  for (const p of periodDefs) periods.push(await prisma.period.create({ data: p }));
  const teaching = periods.filter((p) => !p.isBreak);

  const schoolConfig = await prisma.schoolConfig.create({
    data: {
      id: "school",
      weekdays: "[1,2,3,4,5,6]",
      name: "Anekio School",
      address: "12, Lake Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      phone: "080 4000 1200",
      email: "office@anekio.school",
      affiliation: "CBSE",
      gstin: "29AABCC1234D1Z5",
      pan: "AABCC1234D",
      signatory: "Principal",
      invoiceStyle: "classic",
      sessionStart: "2026-04-01",
      sessionEnd: "2027-03-31",
      payGateway: process.env.RAZORPAY_KEY_ID ? "RAZORPAY" : "NONE",
      payTestMode: true,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
      razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
    },
  });
  await prisma.saasInvoice.deleteMany({ where: { number: "ANEKIO-SUB-2026-0001" } });
  await prisma.saasOrg.deleteMany({
    where: {
      OR: [
        { schoolName: schoolConfig.name },
        { ownerEmail: schoolConfig.email },
        { ownerPhone: schoolConfig.phone },
      ],
    },
  });
  const saasOrg = await prisma.saasOrg.create({
    data: {
      schoolName: schoolConfig.name,
      ownerName: "Vikram Rao",
      ownerEmail: schoolConfig.email,
      ownerPhone: schoolConfig.phone,
      city: schoolConfig.city,
      plan: "Anekio launch plan",
      monthlyPrice: 14999,
      paymentStatus: "PAID",
      subscriptionStatus: "ACTIVE",
      loginUrl: "http://localhost:8081",
      apiUrl: "http://localhost:4000",
      followUpStatus: "ONBOARDING",
      assignedOwner: "Anekio support",
      billingAddress: `${schoolConfig.address}, ${schoolConfig.city}`,
      billingState: schoolConfig.state,
      billingPincode: schoolConfig.pincode,
      gstin: schoolConfig.gstin,
      subscriptionStart: new Date("2026-04-01T00:00:00.000Z"),
      renewalOn: new Date("2027-03-31T00:00:00.000Z"),
      invoices: {
        create: [
          {
            number: "ANEKIO-SUB-2026-0001",
            status: "PAID",
            issueDate: new Date("2026-04-01T00:00:00.000Z"),
            dueDate: new Date("2026-04-10T00:00:00.000Z"),
            description: "Anekio school ERP subscription",
            quantity: 1,
            unitPrice: 12711,
            taxPercent: 18,
            subtotal: 12711,
            taxAmount: 2288,
            total: 14999,
            paidAmount: 14999,
            issuedAt: new Date("2026-04-01T00:00:00.000Z"),
            notes: "Demo subscription seeded for the school subscription page.",
          },
        ],
      },
    },
    include: { invoices: true },
  });
  const subscriptionInvoice = saasOrg.invoices[0];
  if (subscriptionInvoice) {
    await prisma.saasPayment.create({
      data: {
        orgId: saasOrg.id,
        invoiceId: subscriptionInvoice.id,
        amount: 14999,
        provider: "BANK_TRANSFER",
        paymentId: "DEMO-SUB-2026",
        status: "PAID",
        notes: "Demo subscription payment.",
        paidAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    });
  }
  await prisma.schoolHoliday.createMany({
    data: [
      { date: "2026-08-15", name: "Independence Day", source: "seed" },
      { date: "2026-10-02", name: "Gandhi Jayanti", source: "seed" },
      { date: "2026-10-20", name: "Dussehra", source: "seed" },
      { date: "2026-11-08", name: "Diwali", source: "seed" },
      { date: "2026-12-25", name: "Christmas", source: "seed" },
    ],
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const attDays = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
  const allTeachers: { id: string; userId: string }[] = [];
  const weekPays: { invoiceId: string; amount: number; dayOffset: number }[] = [];

  for (const family of FAMILIES) {
    const klass = await prisma.class.create({ data: { name: family.grade, section: "A" } });
    const label = `${family.grade}-A`;
    const room = await prisma.room.create({ data: { name: `Classroom ${label}`, kind: RoomKind.CLASSROOM } });

    const teacherPhone = nextPhone();
    const teacherUser = await prisma.user.create({
      data: {
        email: family.teacher.email,
        password: pass,
        name: family.teacher.name,
        phone: teacherPhone,
        roleId: roleIds.TEACHER,
        teacher: {
          create: {
            employeeId: family.teacher.employeeId,
            joinedOn: session.startsOn,
            qualification: family.teacher.qualification,
            classId: klass.id,
            skills: {
              create: [
                { subjectName: "English", classId: klass.id },
                { subjectName: "Mathematics", classId: klass.id },
              ],
            },
            classes: { create: [{ classId: klass.id }] },
          },
        },
      },
      include: { teacher: true },
    });
    const teacher = teacherUser.teacher!;
    allTeachers.push({ id: teacher.id, userId: teacherUser.id });
    logins.push({
      role: "Teacher",
      name: family.teacher.name,
      email: family.teacher.email,
      password: PASSWORD,
      phone: teacherPhone,
      detail: `Class teacher · ${label}`,
    });

    const [english, maths] = await Promise.all([
      prisma.subject.create({ data: { name: "English", classId: klass.id, teacherId: teacher.id, weightage: 6 } }),
      prisma.subject.create({ data: { name: "Mathematics", classId: klass.id, teacherId: teacher.id, weightage: 6 } }),
    ]);

    await prisma.feeTemplate.create({
      data: {
        classId: klass.id,
        sessionId: session.id,
        name: "Monthly fee",
        dueDay: 10,
        lateKind: "STATIC",
        lateGraceDays: 10,
        lateAmount: 100,
        lateAfter10: 100,
        lateAfter20: 0,
        lines: {
          create: [
            { label: "Tuition", kind: FeeLineKind.FLAT, amount: 8000, sortOrder: 0 },
            { label: "Books", kind: FeeLineKind.FLAT, amount: 600, sortOrder: 1 },
          ],
        },
      },
    });

    for (const day of [1, 2, 3, 4, 5, 6]) {
      for (let i = 0; i < teaching.length; i++) {
        await prisma.timetableSlot.create({
          data: {
            classId: klass.id,
            periodId: teaching[i].id,
            weekday: day,
            subjectId: i % 2 ? maths.id : english.id,
            teacherId: teacher.id,
            roomId: room.id,
          },
        });
      }
    }

    let kidNo = 1;
    for (let p = 0; p < family.parents.length; p++) {
      const parentRow = family.parents[p];
      const parentEmail = `parent.${family.grade}a.${p + 1}@school.test`;
      const phone = nextPhone();
      const parentUser = await prisma.user.create({
        data: {
          email: parentEmail,
          password: pass,
          name: parentRow.name,
          phone,
          roleId: roleIds.PARENT,
        },
      });
      const parent = await prisma.parent.create({
        data: { userId: parentUser.id, phone },
      });
      logins.push({
        role: "Parent",
        name: parentRow.name,
        email: parentEmail,
        password: PASSWORD,
        phone,
        detail: `${label} · ${parentRow.kids.join(", ")}`,
      });

      for (const kidName of parentRow.kids) {
        const studentEmail = `student.${family.grade}a.${String(kidNo).padStart(2, "0")}@school.test`;
        const admissionNo = `ADM-${family.grade}${String(kidNo).padStart(2, "0")}`;
        const born = new Date(`${2020 - Number(family.grade)}-06-15`);
        const studentUser = await prisma.user.create({
          data: {
            email: studentEmail,
            password: pass,
            name: kidName,
            roleId: roleIds.STUDENT,
          },
        });
        const student = await prisma.student.create({
          data: {
            userId: studentUser.id,
            parentId: parent.id,
            classId: klass.id,
            admissionNo,
            name: kidName,
            dateOfBirth: born,
            interests: { create: [{ tag: kidNo % 2 ? PathTag.ARTS : PathTag.SCIENCE }] },
          },
        });
        logins.push({
          role: "Student",
          name: kidName,
          email: studentEmail,
          password: PASSWORD,
          phone: "",
          detail: `${label} · ${admissionNo} · ${parentRow.name}`,
        });

        for (const offset of attDays) {
          const date = new Date(today);
          date.setDate(date.getDate() - offset);
          let status: AttendanceStatus = AttendanceStatus.PRESENT;
          if (kidNo === 2 && offset === 2) status = AttendanceStatus.ABSENT;
          if (kidNo === 7 && (offset === 1 || offset === 4)) status = AttendanceStatus.LATE;
          await prisma.attendance.create({
            data: { studentId: student.id, date, status, markedById: teacherUser.id },
          });
        }

        const overdue = kidNo <= 2;
        const july = await prisma.feeInvoice.create({
          data: {
            studentId: student.id,
            classId: klass.id,
            period: "2026-07",
            title: "July 2026 · Monthly fee",
            amount: 8600,
            linesJson: JSON.stringify([
              { label: "Tuition", kind: "FLAT", amount: 8000 },
              { label: "Books", kind: "FLAT", amount: 600 },
            ]),
            dueDate: new Date("2026-07-10"),
            lateKind: "STATIC",
            lateGraceDays: 10,
            lateAmount: 100,
            lateAfter10: 100,
            lateAfter20: 0,
            status: overdue ? InvoiceStatus.OVERDUE : InvoiceStatus.PAID,
          },
        });
        if (!overdue) {
          await prisma.payment.create({
            data: { invoiceId: july.id, amount: 8600, method: "UPI", paidAt: new Date("2026-07-08") },
          });
        }
        await prisma.feeInvoice.create({
          data: {
            studentId: student.id,
            classId: klass.id,
            period: "2026-08",
            title: "August 2026 · Monthly fee",
            amount: 8600,
            linesJson: JSON.stringify([
              { label: "Tuition", kind: "FLAT", amount: 8000 },
              { label: "Books", kind: "FLAT", amount: 600 },
            ]),
            dueDate: new Date("2026-08-10"),
            lateKind: "STATIC",
            lateGraceDays: 10,
            lateAmount: 100,
            lateAfter10: 100,
            lateAfter20: 0,
            status: InvoiceStatus.DUE,
          },
        });
        if (kidNo === 1) {
          weekPays.push({ invoiceId: july.id, amount: 4200 + Number(family.grade) * 100, dayOffset: Number(family.grade) - 1 });
        }

        kidNo += 1;
      }
    }
  }

  for (const pay of weekPays) {
    if (pay.amount <= 0) continue;
    const paidAt = new Date();
    paidAt.setHours(11, 0, 0, 0);
    paidAt.setDate(paidAt.getDate() - pay.dayOffset);
    await prisma.payment.create({
      data: { invoiceId: pay.invoiceId, amount: pay.amount, method: "CASH", paidAt },
    });
  }

  const clerkPhone = nextPhone();
  const clerk = await prisma.staffMember.create({
    data: {
      name: "Ramesh Kulkarni",
      title: "Clerk",
      employeeId: "S-201",
      phone: clerkPhone,
      joinedOn: session.startsOn,
      kind: StaffKind.OFFICE,
      roleId: roleIds.FEES,
    },
  });
  logins.push({
    role: "Staff",
    name: "Ramesh Kulkarni",
    email: "",
    password: "",
    phone: clerkPhone,
    detail: "Clerk · no login",
  });
  await prisma.staffDay.createMany({
    data: [
      ...allTeachers.flatMap((t, i) =>
        attDays.map((offset) => {
          const date = new Date(today);
          date.setDate(date.getDate() - offset);
          let status: AttendanceStatus = AttendanceStatus.PRESENT;
          if (i === 1 && offset === 2) status = AttendanceStatus.ABSENT;
          if (i === 0 && (offset === 1 || offset === 4)) status = AttendanceStatus.LATE;
          return { teacherId: t.id, date, status };
        })
      ),
      ...attDays.map((offset) => {
        const date = new Date(today);
        date.setDate(date.getDate() - offset);
        return { staffId: clerk.id, date, status: AttendanceStatus.PRESENT };
      }),
    ],
  });

  await prisma.notice.create({
    data: {
      title: "School reopens on Monday",
      body: "Regular timetable. Carry the diary. Fee counter is open till 2 pm.",
      authorId: adminUser.id,
      audiences: { create: [{ portal: "PARENT" }, { portal: "TEACHER" }, { portal: "STUDENT" }] },
    },
  });

  await prisma.leaveType.createMany({
    data: [
      { name: "Planned", forTeacher: true, forStaff: true, forStudent: true, noticeDays: 1, yearlyCap: 10, sortOrder: 0 },
      { name: "Sick", forTeacher: true, forStaff: true, forStudent: true, noticeDays: 0, yearlyCap: 8, sortOrder: 1 },
    ],
  });

  await seedExamDemo(prisma);

  const { jsonPath, csvPath } = writeLoginSheet(logins);
  console.log("Seeded Anekio. Password for everyone: 12345");
  console.log("  Classes: 1-A, 2-A, 3-A, 4-A, 5-A · 10 students · 5 parents each");
  console.log("  Exams: 1-A Unit Test 1 is the live sitting; later plan items stay unscheduled until office schedules them.");
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
