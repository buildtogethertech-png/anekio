/**
 * One-off: copy the old single "class teacher of" column (Teacher.classId, now Teacher.legacyClassId) into
 * TeacherClass.classTeacher, where a teacher can be class teacher of several classes.
 *
 * Run after `prisma db push` has added TeacherClass.classTeacher, before the new API goes live. Safe to run again.
 *   npx tsx scripts/backfill-class-teachers.ts           # dry run: prints what it would change
 *   npx tsx scripts/backfill-class-teachers.ts --apply   # writes
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function backfill() {
  const teachers = await prisma.teacher.findMany({
    where: { legacyClassId: { not: null }, archivedAt: null },
    select: { id: true, orgId: true, legacyClassId: true, user: { select: { name: true } } },
  });
  const links = await prisma.teacherClass.findMany({
    where: { teacherId: { in: teachers.map((t) => t.id) } },
    select: { teacherId: true, classId: true, classTeacher: true },
  });
  const linkOf = new Map(links.map((l) => [`${l.teacherId}:${l.classId}`, l]));

  let created = 0;
  let flagged = 0;
  let already = 0;
  for (const t of teachers) {
    const classId = t.legacyClassId as string;
    const link = linkOf.get(`${t.id}:${classId}`);
    if (link?.classTeacher) {
      already += 1;
      continue;
    }
    if (link) flagged += 1;
    else created += 1;
    if (apply) {
      await prisma.teacherClass.upsert({
        where: { teacherId_classId: { teacherId: t.id, classId } },
        update: { classTeacher: true },
        create: { orgId: t.orgId, teacherId: t.id, classId, classTeacher: true },
      });
    }
  }

  const total = await prisma.teacherClass.count({ where: { classTeacher: true } });
  console.log(
    `${apply ? "Backfilled" : "Dry run"}: ${teachers.length} class teachers in Teacher.classId · ` +
      `${flagged} links flagged · ${created} links created · ${already} already done · ` +
      `${total} TeacherClass rows now flagged${apply ? "" : " (nothing written; add --apply)"}.`
  );
}

backfill()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
