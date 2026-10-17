import { PrismaClient } from "@prisma/client";

function isLocalSqlite(url: string) {
  const value = url.trim();
  if (!value.startsWith("file:")) return false;
  if (value.includes("prod") || value.includes("production")) return false;
  return true;
}

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!isLocalSqlite(url)) {
    throw new Error(`Refusing to reset routine data for DATABASE_URL=${url || "(empty)"}`);
  }
  const prisma = new PrismaClient();
  try {
    const deletedCovers = await prisma.substituteAssignment.deleteMany();
    const deletedSlots = await prisma.timetableSlot.deleteMany();
    const klass = await prisma.class.findFirst({
      where: { name: "1", section: "A" },
      include: {
        subjects: true,
        teachers: { include: { user: true } },
        slots: true,
      },
    });
    const period1 = await prisma.period.findFirst({ where: { isBreak: false }, orderBy: { sortOrder: "asc" } });
    const period2 = await prisma.period.findFirst({
      where: { isBreak: false, NOT: { id: period1?.id || "" } },
      orderBy: { sortOrder: "asc" },
    });
    const english = klass?.subjects.find((row) => row.code === "ENG");
    const maths = klass?.subjects.find((row) => row.code === "MAT");
    const teacherId = english?.teacherId || maths?.teacherId || klass?.teachers[0]?.id;
    const room = await prisma.room.findFirst({ where: { name: "Classroom 1-A" } });
    if (klass && period1 && english && teacherId) {
      await prisma.timetableSlot.create({
        data: {
          classId: klass.id,
          periodId: period1.id,
          weekday: 1,
          subjectId: english.id,
          teacherId,
          roomId: room?.id,
        },
      });
    }
    if (klass && period2 && maths && teacherId) {
      await prisma.timetableSlot.create({
        data: {
          classId: klass.id,
          periodId: period2.id,
          weekday: 1,
          subjectId: maths.id,
          teacherId,
          roomId: room?.id,
        },
      });
    }
    console.log(
      `Cleared ${deletedCovers.count} cover rows and ${deletedSlots.count} timetable slots; rebuilt 1-A Monday P1/P2.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
