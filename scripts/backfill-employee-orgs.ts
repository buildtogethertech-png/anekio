import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function backfill() {
  const [teachers, staffMembers] = await Promise.all([
    prisma.teacher.findMany({
      where: { orgId: null },
      select: { id: true, user: { select: { orgId: true } } },
    }),
    prisma.staffMember.findMany({
      where: { orgId: null },
      select: { id: true, user: { select: { orgId: true } } },
    }),
  ]);

  const teacherUpdates = teachers.filter((teacher) => teacher.user.orgId).map((teacher) =>
    prisma.teacher.update({ where: { id: teacher.id }, data: { orgId: teacher.user.orgId } })
  );
  const staffUpdates = staffMembers.filter((staff) => staff.user?.orgId).map((staff) =>
    prisma.staffMember.update({ where: { id: staff.id }, data: { orgId: staff.user!.orgId } })
  );

  await prisma.$transaction([...teacherUpdates, ...staffUpdates]);
  console.log(`Backfilled ${teacherUpdates.length} teacher and ${staffUpdates.length} staff school assignments.`);
}

backfill()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
