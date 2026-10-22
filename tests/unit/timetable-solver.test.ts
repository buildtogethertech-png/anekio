import { describe, expect, it } from "vitest";
import { checkTimetable, fillTimetable, type SolverInput, type FillResult } from "../../lib/timetable-solver";

const SUBJECTS: [string, number][] = [
  ["English", 7],
  ["Maths", 8],
  ["Science", 7],
  ["Hindi", 6],
  ["SST", 6],
  ["Computer", 4],
  ["Art", 4],
  ["PE", 6],
]; // 48 a week

function school(opts: { grades: number; sections: number; days?: number; periods?: number; teachersPerSubject: Record<string, number> }): SolverInput {
  const days = Array.from({ length: opts.days ?? 6 }, (_, i) => i + 1);
  const periods = Array.from({ length: opts.periods ?? 8 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const classes = [];
  for (let g = 1; g <= opts.grades; g += 1) for (let s = 0; s < opts.sections; s += 1) classes.push({ id: `c${g}${"ABCD"[s]}`, label: `${g}-${"ABCD"[s]}` });
  const teachers: { id: string; name: string; subject: string }[] = [];
  for (const [subject] of SUBJECTS) for (let i = 0; i < (opts.teachersPerSubject[subject] ?? 0); i += 1) teachers.push({ id: `${subject}-${i}`, name: `${subject} teacher ${i + 1}`, subject });
  return {
    days,
    periods,
    teachers,
    existing: [],
    classes: classes.map((c) => ({
      ...c,
      subjects: SUBJECTS.map(([name, need]) => ({
        id: `${c.id}-${name}`,
        label: name,
        need,
        eligible: teachers.filter((t) => t.subject === name).map((t) => t.id),
      })),
    })),
  };
}

/** The hard rules. Any failure here is a real bug. */
function assertValid(input: SolverInput, result: FillResult, strictTeacher = true) {
  const classCell = new Set<string>();
  const teacherCell = new Set<string>();
  for (const s of input.existing) {
    classCell.add(`${s.classId}|${s.day}|${s.periodId}`);
    if (s.teacherId) teacherCell.add(`${s.teacherId}|${s.day}|${s.periodId}`);
  }
  const count = new Map<string, number>();
  const teacherOf = new Map<string, string>();
  for (const p of result.placements) {
    const ck = `${p.classId}|${p.day}|${p.periodId}`;
    const tk = `${p.teacherId}|${p.day}|${p.periodId}`;
    expect(classCell.has(ck), `class double-booked ${ck}`).toBe(false);
    expect(teacherCell.has(tk), `teacher double-booked ${tk}`).toBe(false);
    classCell.add(ck);
    teacherCell.add(tk);
    const klass = input.classes.find((c) => c.id === p.classId)!;
    const subject = klass.subjects.find((s) => s.id === p.subjectId)!;
    expect(subject.eligible).toContain(p.teacherId);
    expect(input.days).toContain(p.day);
    const key = `${p.classId}|${p.subjectId}`;
    count.set(key, (count.get(key) || 0) + 1);
    if (strictTeacher && teacherOf.has(key)) expect(teacherOf.get(key), `one teacher per subject in ${key}`).toBe(p.teacherId);
    teacherOf.set(key, p.teacherId);
  }
  for (const klass of input.classes) {
    for (const subject of klass.subjects) {
      const already = input.existing.filter((s) => s.classId === klass.id && s.subjectId === subject.id).length;
      expect((count.get(`${klass.id}|${subject.id}`) || 0) + already).toBeLessThanOrEqual(Math.max(subject.need, already));
    }
  }
}

describe("checkTimetable", () => {
  it("passes when there are enough teachers", () => {
    const input = school({ grades: 3, sections: 2, teachersPerSubject: { English: 1, Maths: 2, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    const check = checkTimetable(input);
    expect(check.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.needed).toBe(6 * 48);
  });

  it("works out capacity from periods x days x teachers, with no setting", () => {
    // 12 classes x 48 = 576 periods; 10 teachers x 48 = 480.
    const input = school({ grades: 6, sections: 2, teachersPerSubject: { English: 2, Maths: 2, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    const check = checkTimetable(input);
    expect(check.capacity).toBe(480);
    const short = check.issues.find((i) => i.kind === "SCHOOL_SHORT");
    expect(short?.periods).toBe(96);
    expect(short?.text).toContain("2 more teachers");
    expect(check.ok).toBe(false);
  });

  it("names a subject nobody can teach", () => {
    const input = school({ grades: 1, sections: 1, teachersPerSubject: { English: 1, Maths: 1, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1 } });
    const check = checkTimetable(input);
    const issue = check.issues.find((i) => i.kind === "NO_TEACHER");
    expect(issue?.subjectLabel).toBe("PE");
    expect(issue?.text).toContain("1-A PE");
  });

  it("finds a subject short of teacher time even when the school total is fine", () => {
    // 4 classes need 8 Maths each = 32, one Maths teacher has 5 days x 6 periods = 30.
    const input = school({ grades: 2, sections: 2, days: 5, periods: 6, teachersPerSubject: { English: 2, Maths: 1, Science: 2, Hindi: 2, SST: 2, Computer: 1, Art: 1, PE: 2 } });
    for (const c of input.classes) c.subjects = c.subjects.filter((s) => s.label !== "PE").map((s) => (s.label === "Hindi" ? { ...s, need: 1 } : s));
    const check = checkTimetable(input);
    const issue = check.issues.find((i) => i.kind === "SUBJECT_SHORT");
    expect(issue?.subjectLabel).toBe("Maths");
    expect(issue?.periods).toBe(2);
  });

  it("flags a class with more periods than the week", () => {
    const input = school({ grades: 1, sections: 1, days: 5, teachersPerSubject: { English: 1, Maths: 1, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    const check = checkTimetable(input); // 48 needed, 40 cells
    const issue = check.issues.find((i) => i.kind === "CLASS_OVER");
    expect(issue?.periods).toBe(8);
  });
});

describe("fillTimetable", () => {
  it("fills a 12-class school completely with no clashes", () => {
    const input = school({ grades: 6, sections: 2, teachersPerSubject: { English: 2, Maths: 3, Science: 2, Hindi: 2, SST: 2, Computer: 1, Art: 1, PE: 2 } });
    expect(checkTimetable(input).ok).toBe(true);
    const started = Date.now();
    const result = fillTimetable(input);
    assertValid(input, result);
    expect(result.unplaced).toEqual([]);
    expect(result.placed).toBe(12 * 48);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("fills a tight school where teachers are almost fully booked", () => {
    // 8 classes: the one Hindi, SST and PE teachers are each booked 48 of 48 periods.
    const input = school({ grades: 4, sections: 2, teachersPerSubject: { English: 2, Maths: 2, Science: 2, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    expect(checkTimetable(input).ok).toBe(true);
    const result = fillTimetable(input);
    assertValid(input, result);
    expect(result.placed).toBe(result.needed);
  });

  it("keeps hand-placed periods and only fills the rest", () => {
    const input = school({ grades: 2, sections: 1, teachersPerSubject: { English: 1, Maths: 1, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    input.existing = [
      { classId: "c1A", day: 1, periodId: "p1", subjectId: "c1A-Maths", teacherId: "Maths-0" },
      { classId: "c1A", day: 1, periodId: "p2", subjectId: "c1A-Maths", teacherId: "Maths-0" },
      { classId: "c2A", day: 1, periodId: "p3", subjectId: "c2A-English", teacherId: "English-0" },
    ];
    const result = fillTimetable(input);
    assertValid(input, result);
    expect(result.placed).toBe(2 * 48 - 3);
    expect(result.placements.filter((p) => p.classId === "c1A" && p.subjectId === "c1A-Maths")).toHaveLength(6);
  });

  it("spreads a subject across the week", () => {
    const input = school({ grades: 2, sections: 2, teachersPerSubject: { English: 1, Maths: 2, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    const result = fillTimetable(input);
    const perDay = new Map<string, number>();
    for (const p of result.placements) perDay.set(`${p.classId}|${p.subjectId}|${p.day}`, (perDay.get(`${p.classId}|${p.subjectId}|${p.day}`) || 0) + 1);
    // 6 days: Maths (8) may repeat on at most 2 days; Hindi (6) should be once a day.
    for (const [key, n] of perDay) {
      if (key.includes("Hindi")) expect(n).toBe(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });

  it("reports what it could not place, with a reason, instead of clashing", () => {
    const input = school({ grades: 3, sections: 2, teachersPerSubject: { English: 1, Maths: 1, Science: 1, Hindi: 1, SST: 1, Computer: 1, Art: 1, PE: 1 } });
    // Maths: 6 classes x 8 = 48 = all of one teacher's week, but some cells clash with other needs.
    const result = fillTimetable(input);
    assertValid(input, result, false);
    for (const u of result.unplaced) expect(u.reason.length).toBeGreaterThan(5);
  });
});

describe("fillTimetable on random schools", () => {
  it("never clashes, and fills every period whenever the check passes", () => {
    let seed = 2024;
    const r = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const names = ["Eng", "Mat", "Sci", "Hin", "SST", "Com", "Art", "PE"];
    for (let n = 0; n < 6; n += 1) {
      const days = [1, 2, 3, 4, 5, 6].slice(0, 5 + Math.floor(r() * 2));
      const periods = Array.from({ length: 6 + Math.floor(r() * 3) }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
      const cells = days.length * periods.length;
      const teachers = Array.from({ length: 8 + Math.floor(r() * 6) }, (_, i) => ({ id: `t${i}`, name: `T${i}`, subs: names.filter(() => r() < 0.3) }));
      const classes = Array.from({ length: 4 + Math.floor(r() * 5) }, (_, c) => {
        let left = cells;
        return {
          id: `c${c}`,
          label: `C${c}`,
          subjects: names.map((s, i) => {
            const need = i === names.length - 1 ? left : Math.min(left, Math.max(2, Math.round(cells / 8 + (r() - 0.5) * 3)));
            left -= need;
            return { id: `c${c}-${s}`, label: s, need, eligible: teachers.filter((t) => t.subs.includes(s)).map((t) => t.id) };
          }),
        };
      });
      const input: SolverInput = { days, periods, classes, teachers, existing: [], timeLimitMs: 1200 };
      const check = checkTimetable(input);
      const result = fillTimetable(input);
      assertValid(input, result, false);
      if (check.ok) expect(result.placed, `school ${n}`).toBe(result.needed);
    }
  }, 60_000);
});
