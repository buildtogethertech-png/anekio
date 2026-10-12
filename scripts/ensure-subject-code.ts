import { prisma } from "../lib/prisma";
import { ensureSubjectCodeSchema, validateSubjectCode } from "../lib/subject-code";

async function main() {
  await ensureSubjectCodeSchema();
  const subjects = await prisma.subject.findMany({ select: { id: true, classId: true, code: true, name: true } });
  const invalid = subjects.filter((row) => !validateSubjectCode(row.code).ok);
  if (invalid.length) {
    throw new Error(`Invalid subject codes remain: ${invalid.map((row) => `${row.id}:${row.code}`).join(", ")}`);
  }
  const codeKeys = new Set<string>();
  const nameKeys = new Set<string>();
  for (const row of subjects) {
    const codeKey = `${row.classId}::${row.code}`;
    const nameKey = `${row.classId}::${row.name.trim().toLowerCase()}`;
    if (codeKeys.has(codeKey)) throw new Error(`Duplicate class code ${row.code}`);
    if (nameKeys.has(nameKey)) throw new Error(`Duplicate class name ${row.name}`);
    codeKeys.add(codeKey);
    nameKeys.add(nameKey);
  }
  const configs = await prisma.schoolConfig.findMany({ select: { id: true, subjectCatalog: true } });
  for (const config of configs) {
    const parsed = JSON.parse(config.subjectCatalog || "[]") as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item === "string")) {
      throw new Error(`Catalog ${config.id} is not object-shaped`);
    }
  }
  console.log(`Subject codes ready for ${subjects.length} subjects.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
