import { PATH_LABEL, percent } from "./utils";

type Result = {
  marks: number;
  exam: { maxMarks: number; title: string; subject: { name: string } };
};

type Entry = {
  rank: number | null;
  result: string | null;
  contest: { title: string; type: string };
};

type Interest = { tag: string };

export function studentLetter(input: {
  name: string;
  interests: Interest[];
  results: Result[];
  entries: Entry[];
}) {
  const bySubject = new Map<string, { total: number; max: number; n: number }>();
  for (const r of input.results) {
    const name = r.exam.subject.name;
    const cur = bySubject.get(name) ?? { total: 0, max: 0, n: 0 };
    cur.total += r.marks;
    cur.max += r.exam.maxMarks;
    cur.n += 1;
    bySubject.set(name, cur);
  }

  const subjects = Array.from(bySubject.entries())
    .map(([name, v]) => ({ name, pct: percent(v.total, v.max) }))
    .sort((a, b) => b.pct - a.pct);

  const strong = subjects.filter((s) => s.pct >= 80);
  const growthAreas = subjects.filter((s) => s.pct < 70);
  const paths = input.interests.map((i) => PATH_LABEL[i.tag] ?? i.tag);
  const standouts = input.entries.filter((e) => e.rank && e.rank <= 3);

  const lines: string[] = [];
  lines.push(
    `${input.name} is not a percentage. ${input.name.split(" ")[0]} is a path.`
  );

  if (paths.length) {
    lines.push(
      `The path we are cultivating: ${paths.join(", ")}. That is what matters — not a rank for rank’s sake.`
    );
  }

  if (strong.length) {
    lines.push(
      `Strength already showing: ${strong
        .map((s) => `${s.name} (${s.pct}%)`)
        .join(", ")}. Push here. This is where the child can go far.`
    );
  }

  if (growthAreas.length) {
    lines.push(
      `Where we grow next: ${growthAreas
        .map((s) => `${s.name} (${s.pct}%)`)
        .join(", ")}. Not failure — unfinished strength.`
    );
  }

  if (standouts.length) {
    lines.push(
      `Breakout moments: ${standouts
        .map(
          (e) =>
            `${e.contest.title} (rank ${e.rank}${e.result ? `, ${e.result}` : ""})`
        )
        .join("; ")}.`
    );
  } else if (input.entries.length) {
    lines.push(
      `Contests are in motion. Showing up is the first cultivation. Results will follow the work.`
    );
  }

  if (!input.results.length && !input.entries.length) {
    lines.push(
      `The record is still young. Watch the path, not the marksheet. We will write this letter as the work accumulates.`
    );
  }

  return { lines, subjects, strong, growthAreas, paths, standouts };
}
