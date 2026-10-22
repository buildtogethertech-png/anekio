/**
 * School-wide timetable check + auto-fill. Pure logic: no database, no clock.
 *
 * Capacity needs no setting: a teacher can be in one class per period, so a teacher
 * has (days x teaching periods) cells a week, minus cells already used.
 *
 * Rules that are never broken:
 *   - one lesson per class per cell, one class per teacher per cell
 *   - a teacher only teaches a subject they are eligible for in that class (TeacherSkill)
 *   - existing (hand-placed) periods stay where they are
 * Preferences:
 *   - one teacher per subject per class for the whole week
 *   - a subject at most once a day (more only when it has more periods than days)
 *   - each teacher's lessons spread evenly across days
 */

export type SolverPeriod = { id: string; name: string };
export type SolverSubject = {
  id: string;
  label: string;
  /** Periods per week this subject should have in this class. */
  need: number;
  /** Teachers allowed to teach it in this class. */
  eligible: string[];
  /** Teacher already linked to this subject in this class (Subject.teacherId), if any. */
  preferred?: string | null;
};
export type SolverClass = { id: string; label: string; subjects: SolverSubject[] };
export type SolverTeacher = { id: string; name: string };
export type SolverSlot = { classId: string; day: number; periodId: string; subjectId: string | null; teacherId: string | null };

export type SolverInput = {
  days: number[];
  dayLabels?: Record<number, string>;
  periods: SolverPeriod[];
  classes: SolverClass[];
  teachers: SolverTeacher[];
  /** Periods already in the timetable. They are kept. */
  existing: SolverSlot[];
  seed?: number;
  /** Stop trying new orders after this many ms (default 2500). */
  timeLimitMs?: number;
};

export type CheckIssue = {
  level: "error" | "warn";
  kind: "SCHOOL_SHORT" | "CLASS_OVER" | "NO_TEACHER" | "SUBJECT_SHORT" | "TEACHER_OVER";
  text: string;
  classId?: string;
  subjectId?: string;
  subjectLabel?: string;
  teacherId?: string;
  periods?: number;
};

export type CheckResult = {
  cellsPerWeek: number;
  teachers: number;
  needed: number;
  capacity: number;
  issues: CheckIssue[];
  ok: boolean;
};

export type Placement = { classId: string; day: number; periodId: string; subjectId: string; teacherId: string };
export type Unplaced = { classId: string; classLabel: string; subjectId: string; subjectLabel: string; teacherId: string; count: number; reason: string };
export type FillResult = {
  placements: Placement[];
  unplaced: Unplaced[];
  needed: number;
  placed: number;
  /** Teacher chosen for each class+subject that needed periods. */
  assignments: { classId: string; subjectId: string; teacherId: string }[];
};

const cellKey = (day: number, periodId: string) => `${day}|${periodId}`;

/** Remaining periods per class+subject after what is already placed. */
function remainingNeeds(input: SolverInput) {
  const placed = new Map<string, number>();
  for (const s of input.existing) {
    if (!s.subjectId) continue;
    const k = `${s.classId}|${s.subjectId}`;
    placed.set(k, (placed.get(k) || 0) + 1);
  }
  const rows: { klass: SolverClass; subject: SolverSubject; remaining: number }[] = [];
  for (const klass of input.classes) {
    for (const subject of klass.subjects) {
      const remaining = Math.max(0, (subject.need || 0) - (placed.get(`${klass.id}|${subject.id}`) || 0));
      rows.push({ klass, subject, remaining });
    }
  }
  return rows;
}

function usedCells(input: SolverInput) {
  const validCells = new Set(input.days.flatMap((d) => input.periods.map((p) => cellKey(d, p.id))));
  const byClass = new Map<string, Set<string>>();
  const byTeacher = new Map<string, Set<string>>();
  for (const s of input.existing) {
    const key = cellKey(s.day, s.periodId);
    if (!validCells.has(key)) continue;
    if (!byClass.has(s.classId)) byClass.set(s.classId, new Set());
    byClass.get(s.classId)!.add(key);
    if (s.teacherId) {
      if (!byTeacher.has(s.teacherId)) byTeacher.set(s.teacherId, new Set());
      byTeacher.get(s.teacherId)!.add(key);
    }
  }
  return { byClass, byTeacher };
}

/** Max-flow (Dinic) on a small graph. */
class Flow {
  private adj: { to: number; cap: number; rev: number }[][] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i += 1) this.adj.push([]);
  }
  add(a: number, b: number, cap: number) {
    this.adj[a].push({ to: b, cap, rev: this.adj[b].length });
    this.adj[b].push({ to: a, cap: 0, rev: this.adj[a].length - 1 });
    return this.adj[a].length - 1;
  }
  edge(a: number, i: number) {
    return this.adj[a][i];
  }
  run(s: number, t: number) {
    let total = 0;
    const n = this.adj.length;
    for (;;) {
      const level = new Array(n).fill(-1);
      level[s] = 0;
      const q = [s];
      for (let h = 0; h < q.length; h += 1) for (const e of this.adj[q[h]]) if (e.cap > 0 && level[e.to] < 0) {
        level[e.to] = level[q[h]] + 1;
        q.push(e.to);
      }
      if (level[t] < 0) return total;
      const it = new Array(n).fill(0);
      const dfs = (v: number, f: number): number => {
        if (v === t) return f;
        for (; it[v] < this.adj[v].length; it[v] += 1) {
          const e = this.adj[v][it[v]];
          if (e.cap > 0 && level[e.to] === level[v] + 1) {
            const d = dfs(e.to, Math.min(f, e.cap));
            if (d > 0) {
              e.cap -= d;
              this.adj[e.to][e.rev].cap += d;
              return d;
            }
          }
        }
        return 0;
      };
      for (let f = dfs(s, Infinity); f > 0; f = dfs(s, Infinity)) total += f;
    }
  }
}

/** Can the school cover every period? Plain-language issues, nothing to configure. */
export function checkTimetable(input: SolverInput): CheckResult {
  const cellsPerWeek = input.days.length * input.periods.length;
  const issues: CheckIssue[] = [];
  const rows = remainingNeeds(input).filter((r) => r.remaining > 0);
  const { byClass, byTeacher } = usedCells(input);
  const teacherIds = new Set(input.teachers.map((t) => t.id));
  const name = (id: string) => input.teachers.find((t) => t.id === id)?.name || "Teacher";
  const freeOf = (teacherId: string) => Math.max(0, cellsPerWeek - (byTeacher.get(teacherId)?.size || 0));

  // Class: more periods planned than the week has.
  for (const klass of input.classes) {
    const need = rows.filter((r) => r.klass.id === klass.id).reduce((n, r) => n + r.remaining, 0);
    const free = cellsPerWeek - (byClass.get(klass.id)?.size || 0);
    if (need > free) {
      issues.push({
        level: "error",
        kind: "CLASS_OVER",
        classId: klass.id,
        periods: need - free,
        text: `${klass.label} needs ${need} more periods but only ${free} are free in the week. Reduce ${need - free} periods in its subjects.`,
      });
    }
  }

  // Subject with nobody who can teach it.
  for (const r of rows) {
    if (!r.subject.eligible.some((id) => teacherIds.has(id))) {
      issues.push({
        level: "error",
        kind: "NO_TEACHER",
        classId: r.klass.id,
        subjectId: r.subject.id,
        subjectLabel: r.subject.label,
        periods: r.remaining,
        text: `${r.klass.label} ${r.subject.label}: ${r.remaining} periods a week but no teacher is assigned to teach it.`,
      });
    }
  }

  const needed = rows.reduce((n, r) => n + r.remaining, 0);
  const capacity = input.teachers.reduce((n, t) => n + freeOf(t.id), 0);
  if (needed > capacity) {
    const short = needed - capacity;
    const more = Math.ceil(short / Math.max(1, cellsPerWeek));
    issues.push({
      level: "error",
      kind: "SCHOOL_SHORT",
      periods: short,
      text: `The school needs ${needed} periods but ${input.teachers.length} teachers can take at most ${capacity}. Short by ${short} periods (about ${more} more ${more === 1 ? "teacher" : "teachers"}).`,
    });
  }

  // Subject shortage across the school, with shared teachers handled properly (max-flow).
  const teachable = rows.filter((r) => r.subject.eligible.some((id) => teacherIds.has(id)));
  if (teachable.length) {
    const tList = input.teachers;
    const S = 0;
    const T = 1 + teachable.length + tList.length;
    const flow = new Flow(T + 1);
    const demandEdge = teachable.map((r, i) => flow.add(S, 1 + i, r.remaining));
    teachable.forEach((r, i) => {
      for (const id of r.subject.eligible) {
        const ti = tList.findIndex((t) => t.id === id);
        if (ti >= 0) flow.add(1 + i, 1 + teachable.length + ti, r.remaining);
      }
    });
    tList.forEach((t, ti) => flow.add(1 + teachable.length + ti, T, freeOf(t.id)));
    flow.run(S, T);
    const shortBySubject = new Map<string, { label: string; short: number; classes: string[] }>();
    teachable.forEach((r, i) => {
      const left = flow.edge(S, demandEdge[i]).cap;
      if (left <= 0) return;
      const key = r.subject.label.toLowerCase();
      const row = shortBySubject.get(key) || { label: r.subject.label, short: 0, classes: [] };
      row.short += left;
      row.classes.push(r.klass.label);
      shortBySubject.set(key, row);
    });
    for (const row of shortBySubject.values()) {
      issues.push({
        level: "error",
        kind: "SUBJECT_SHORT",
        subjectLabel: row.label,
        periods: row.short,
        text: `${row.label}: not enough teacher time. Short by ${row.short} ${row.short === 1 ? "period" : "periods"} (${row.classes.join(", ")}). Add a ${row.label} teacher or let another teacher take it.`,
      });
    }
  }

  // Teachers already over the week (hand-placed) — a warning only.
  for (const [teacherId, cells] of byTeacher) {
    if (cells.size > cellsPerWeek) {
      issues.push({ level: "warn", kind: "TEACHER_OVER", teacherId, text: `${name(teacherId)} has more periods than the week has.` });
    }
  }

  return { cellsPerWeek, teachers: input.teachers.length, needed, capacity, issues, ok: !issues.some((i) => i.level === "error") };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

type Group = {
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectLabel: string;
  teacherId: string;
  left: number;
  maxPerDay: number;
};

/**
 * Split periods between teachers with max-flow so no teacher goes over their free cells.
 * Returns periods per (row index, teacher). Used only when whole-subject assignment cannot fit.
 */
function flowSplit(rows: { remaining: number; eligible: string[] }[], teachers: string[], free: (id: string) => number, prefer: (i: number) => string) {
  const S = 0;
  const T = 1 + rows.length + teachers.length;
  const flow = new Flow(T + 1);
  const edges: { i: number; teacher: string; edge: number }[] = [];
  rows.forEach((r, i) => {
    flow.add(S, 1 + i, r.remaining);
    // Preferred teacher first so Dinic tends to keep the subject with them.
    const order = [prefer(i), ...r.eligible.filter((id) => id !== prefer(i))].filter((id) => teachers.includes(id));
    for (const id of order) edges.push({ i, teacher: id, edge: flow.add(1 + i, 1 + rows.length + teachers.indexOf(id), r.remaining) });
  });
  teachers.forEach((id, ti) => flow.add(1 + rows.length + ti, T, free(id)));
  flow.run(S, T);
  const out = new Map<number, Map<string, number>>();
  for (const e of edges) {
    const used = rows[e.i].remaining - flow.edge(1 + e.i, e.edge).cap;
    if (used <= 0) continue;
    if (!out.has(e.i)) out.set(e.i, new Map());
    out.get(e.i)!.set(e.teacher, used);
  }
  return out;
}

/** One attempt: pick teachers, then place the hardest lessons first, then repair. */
function attempt(input: SolverInput, seed: number): FillResult {
  const rand = rng(seed);
  const cellsPerWeek = input.days.length * input.periods.length;
  const teacherIds = new Set(input.teachers.map((t) => t.id));
  const cells = input.days.flatMap((day) => input.periods.map((p) => ({ day, periodId: p.id, key: cellKey(day, p.id) })));
  const validKeys = new Set(cells.map((c) => c.key));

  const classBusy = new Map<string, Set<string>>();
  const teacherBusy = new Map<string, Set<string>>();
  const subjectDay = new Map<string, number>(); // class|subject|day -> count
  const teacherDay = new Map<string, number>(); // teacher|day -> count
  const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) || 0) + by);
  const setOf = (m: Map<string, Set<string>>, k: string) => {
    if (!m.has(k)) m.set(k, new Set());
    return m.get(k)!;
  };
  const existingTeacher = new Map<string, string>(); // class|subject -> teacher from placed periods
  for (const s of input.existing) {
    const key = cellKey(s.day, s.periodId);
    if (!validKeys.has(key)) continue;
    setOf(classBusy, s.classId).add(key);
    if (s.teacherId) {
      setOf(teacherBusy, s.teacherId).add(key);
      bump(teacherDay, `${s.teacherId}|${s.day}`);
    }
    if (s.subjectId) {
      bump(subjectDay, `${s.classId}|${s.subjectId}|${s.day}`);
      if (s.teacherId && !existingTeacher.has(`${s.classId}|${s.subjectId}`)) existingTeacher.set(`${s.classId}|${s.subjectId}`, s.teacherId);
    }
  }
  const freeCells = (id: string) => cellsPerWeek - (teacherBusy.get(id)?.size || 0);

  // 1) One teacher per class+subject. Fewest options first, then biggest blocks.
  const rows = remainingNeeds(input)
    .filter((r) => r.remaining > 0)
    .map((r) => ({ ...r, eligible: r.subject.eligible.filter((id) => teacherIds.has(id)) }))
    .filter((r) => r.eligible.length > 0)
    .sort((a, b) => a.eligible.length - b.eligible.length || b.remaining - a.remaining || rand() - 0.5);
  const load = new Map<string, number>();
  const chosen: string[] = [];
  const teachesClass = (id: string, classId: string) =>
    rows.some((r, i) => chosen[i] === id && r.klass.id === classId) || input.existing.some((s) => s.teacherId === id && s.classId === classId);
  rows.forEach((r, i) => {
    const fixed = [existingTeacher.get(`${r.klass.id}|${r.subject.id}`), r.subject.preferred].find((id) => id && r.eligible.includes(id));
    const teacherId =
      fixed ||
      [...r.eligible].sort((a, b) => {
        const fitsA = (load.get(a) || 0) + r.remaining <= freeCells(a) ? 0 : 1;
        const fitsB = (load.get(b) || 0) + r.remaining <= freeCells(b) ? 0 : 1;
        return fitsA - fitsB || Number(teachesClass(b, r.klass.id)) - Number(teachesClass(a, r.klass.id)) || (load.get(a) || 0) - (load.get(b) || 0) || rand() - 0.5;
      })[0];
    chosen[i] = teacherId;
    load.set(teacherId, (load.get(teacherId) || 0) + r.remaining);
  });
  // Nobody may be booked past their week: move whole subjects to a teacher with room.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [t, n] of [...load]) {
      if (n <= freeCells(t)) continue;
      const mine = rows.map((r, i) => ({ r, i })).filter(({ i }) => chosen[i] === t).sort((a, b) => a.r.remaining - b.r.remaining);
      for (const { r, i } of mine) {
        if ((load.get(t) || 0) <= freeCells(t)) break;
        const to = r.eligible
          .filter((u) => u !== t && (load.get(u) || 0) + r.remaining <= freeCells(u))
          .sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0))[0];
        if (!to) continue;
        chosen[i] = to;
        load.set(t, (load.get(t) || 0) - r.remaining);
        load.set(to, (load.get(to) || 0) + r.remaining);
      }
    }
  }
  const groups: Group[] = [];
  const addGroup = (r: (typeof rows)[number], teacherId: string, left: number) => {
    const g: Group = {
      classId: r.klass.id,
      classLabel: r.klass.label,
      subjectId: r.subject.id,
      subjectLabel: r.subject.label,
      teacherId,
      left,
      maxPerDay: Math.max(1, Math.ceil(r.subject.need / Math.max(1, input.days.length))),
    };
    groups.push(g);
    return g;
  };
  const overloaded = [...load].some(([t, n]) => n > freeCells(t));
  if (overloaded) {
    // Still over: split only as much as needed, the way the check proved is possible.
    const split = flowSplit(rows, [...teacherIds], freeCells, (i) => chosen[i]);
    rows.forEach((r, i) => {
      const parts = split.get(i);
      if (!parts || !parts.size) return void addGroup(r, chosen[i], r.remaining);
      let given = 0;
      for (const [t, n] of [...parts].sort((a, b) => b[1] - a[1])) {
        addGroup(r, t, n);
        given += n;
      }
      if (given < r.remaining) groups.find((g) => g.classId === r.klass.id && g.subjectId === r.subject.id)!.left += r.remaining - given;
    });
  } else {
    rows.forEach((r, i) => addGroup(r, chosen[i], r.remaining));
  }

  const placements: Placement[] = [];
  const groupOf = (p: Placement) => groups.find((x) => x.classId === p.classId && x.subjectId === p.subjectId && x.teacherId === p.teacherId)!;
  const free = (g: Group, c: { day: number; key: string }, relaxDay = 0) =>
    !setOf(classBusy, g.classId).has(c.key) &&
    !setOf(teacherBusy, g.teacherId).has(c.key) &&
    (subjectDay.get(`${g.classId}|${g.subjectId}|${c.day}`) || 0) < g.maxPerDay + relaxDay;
  const place = (g: Group, c: { day: number; periodId: string; key: string }) => {
    setOf(classBusy, g.classId).add(c.key);
    setOf(teacherBusy, g.teacherId).add(c.key);
    bump(subjectDay, `${g.classId}|${g.subjectId}|${c.day}`);
    bump(teacherDay, `${g.teacherId}|${c.day}`);
    placements.push({ classId: g.classId, day: c.day, periodId: c.periodId, subjectId: g.subjectId, teacherId: g.teacherId });
    g.left -= 1;
  };
  const unplace = (p: Placement) => {
    const key = cellKey(p.day, p.periodId);
    setOf(classBusy, p.classId).delete(key);
    setOf(teacherBusy, p.teacherId).delete(key);
    bump(subjectDay, `${p.classId}|${p.subjectId}|${p.day}`, -1);
    bump(teacherDay, `${p.teacherId}|${p.day}`, -1);
    placements.splice(placements.indexOf(p), 1);
    groupOf(p).left += 1;
  };
  const cellOf = (p: Placement) => ({ day: p.day, periodId: p.periodId, key: cellKey(p.day, p.periodId) });
  const score = (g: Group, c: { day: number; periodId: string }) =>
    (subjectDay.get(`${g.classId}|${g.subjectId}|${c.day}`) || 0) * 10 + (teacherDay.get(`${g.teacherId}|${c.day}`) || 0) + rand() * 0.5;

  /**
   * One-step repair: find a cell where g is blocked only by lessons this run placed
   * (its class is busy there, or its teacher is), move those lessons elsewhere, then use the cell.
   * Hand-placed periods never move.
   */
  const repair = (g: Group): boolean => {
    for (const c of cells) {
      if ((subjectDay.get(`${g.classId}|${g.subjectId}|${c.day}`) || 0) >= g.maxPerDay) continue;
      const at = (p: Placement) => p.day === c.day && p.periodId === c.periodId;
      const classTaken = setOf(classBusy, g.classId).has(c.key);
      const teacherTaken = setOf(teacherBusy, g.teacherId).has(c.key);
      const classBlock = placements.find((p) => at(p) && p.classId === g.classId);
      const teacherBlock = placements.find((p) => at(p) && p.teacherId === g.teacherId);
      if (classTaken && !classBlock) continue;
      if (teacherTaken && !teacherBlock) continue;
      const blockers = [...new Set([classBlock, teacherBlock].filter((p): p is Placement => Boolean(p)))];
      if (!blockers.length) continue;
      const moved: { from: Placement; to: Placement }[] = [];
      let ok = true;
      for (const b of blockers) {
        const bg = groupOf(b);
        unplace(b);
        const target = cells.filter((o) => o.key !== c.key && free(bg, o)).sort((x, y) => score(bg, x) - score(bg, y))[0];
        if (!target) {
          place(bg, cellOf(b));
          ok = false;
          break;
        }
        place(bg, target);
        moved.push({ from: b, to: placements[placements.length - 1] });
      }
      if (ok && free(g, c)) {
        place(g, c);
        return true;
      }
      for (const m of moved.reverse()) {
        const bg = groupOf(m.to);
        unplace(m.to);
        place(bg, cellOf(m.from));
      }
    }
    return false;
  };

  // 2) Place lessons: always the group with the fewest spare cells next.
  const stuck = new Set<Group>();
  for (let guard = 0; guard < 100_000; guard += 1) {
    const todo = groups.filter((g) => g.left > 0 && !stuck.has(g));
    if (!todo.length) break;
    let best: Group | null = null;
    let bestOptions = Infinity;
    for (const g of todo) {
      const n = cells.reduce((acc, c) => acc + (free(g, c) ? 1 : 0), 0);
      const pressure = n - g.left;
      if (pressure < bestOptions || (pressure === bestOptions && rand() < 0.5)) {
        best = g;
        bestOptions = pressure;
      }
    }
    const g = best!;
    const options = cells.filter((c) => free(g, c));
    if (options.length) {
      options.sort((a, b) => score(g, a) - score(g, b));
      place(g, options[0]);
      continue;
    }
    if (repair(g)) continue;
    const relaxed = cells.filter((c) => free(g, c, 1)).sort((a, b) => score(g, a) - score(g, b));
    if (relaxed.length) {
      place(g, relaxed[0]);
      continue;
    }
    stuck.add(g);
  }

  // 3) Exact fallback (bipartite edge colouring): a cell free for the class (a), one free for the
  // teacher (b); swap a<->b along the chain of lessons alternating between them. When no class or
  // teacher has more lessons than cells this always succeeds, unless a hand-placed period is in the
  // chain. It may repeat a subject on a day; it never creates a clash.
  const fixedAt = (cell: string, who: { classId?: string; teacherId?: string }) =>
    input.existing.some((s) => cellKey(s.day, s.periodId) === cell && (who.classId ? s.classId === who.classId : s.teacherId === who.teacherId));
  const lessonAt = (cell: string, who: { classId?: string; teacherId?: string }) =>
    placements.find((p) => cellKey(p.day, p.periodId) === cell && (who.classId ? p.classId === who.classId : p.teacherId === who.teacherId));
  const kempe = (g: Group): boolean => {
    const classFree = cells.filter((c) => !setOf(classBusy, g.classId).has(c.key));
    const teacherFree = cells.filter((c) => !setOf(teacherBusy, g.teacherId).has(c.key));
    for (const ca of classFree) {
      if (!setOf(teacherBusy, g.teacherId).has(ca.key)) {
        place(g, ca);
        return true;
      }
      for (const cb of teacherFree) {
        const chain: Placement[] = [];
        let ok = true;
        let side: "teacher" | "class" = "teacher";
        let id = g.teacherId;
        let cell = ca.key;
        for (let guard = 0; guard < 5000; guard += 1) {
          const who = side === "teacher" ? { teacherId: id } : { classId: id };
          if (fixedAt(cell, who)) {
            ok = false;
            break;
          }
          const p = lessonAt(cell, who);
          if (!p || chain.includes(p)) break;
          chain.push(p);
          side = side === "teacher" ? "class" : "teacher";
          id = side === "class" ? p.classId : p.teacherId;
          cell = cell === ca.key ? cb.key : ca.key;
        }
        if (!ok) continue;
        const moves = chain.map((p) => ({ p, group: groupOf(p), to: cellKey(p.day, p.periodId) === ca.key ? cb : ca }));
        for (const m of moves) unplace(m.p);
        const clash = moves.some((m) => setOf(classBusy, m.p.classId).has(m.to.key) || setOf(teacherBusy, m.p.teacherId).has(m.to.key));
        if (clash) {
          for (const m of moves) place(m.group, cellOf(m.p));
          continue;
        }
        for (const m of moves) place(m.group, m.to);
        if (!setOf(classBusy, g.classId).has(ca.key) && !setOf(teacherBusy, g.teacherId).has(ca.key)) {
          place(g, ca);
          return true;
        }
      }
    }
    return false;
  };
  for (const g of groups.filter((x) => x.left > 0)) while (g.left > 0 && kempe(g)) {}

  // 4) Last resort: hand leftover periods to another eligible teacher who still has room.
  for (const g of groups.filter((x) => x.left > 0)) {
    const r = rows.find((x) => x.klass.id === g.classId && x.subject.id === g.subjectId);
    const used = (id: string) => teacherBusy.get(id)?.size || 0;
    for (const other of (r?.eligible || []).filter((id) => id !== g.teacherId).sort((a, b) => used(a) - used(b))) {
      if (g.left <= 0) break;
      const room = cellsPerWeek - used(other) - groups.filter((x) => x.teacherId === other).reduce((n, x) => n + x.left, 0);
      if (room <= 0) continue;
      const h = groups.find((x) => x.classId === g.classId && x.subjectId === g.subjectId && x.teacherId === other) || addGroup(r!, other, 0);
      const move = Math.min(room, g.left);
      g.left -= move;
      h.left += move;
      while (h.left > 0 && kempe(h)) {}
    }
  }

  const name = (id: string) => input.teachers.find((t) => t.id === id)?.name || "The teacher";
  const unplaced: Unplaced[] = groups
    .filter((g) => g.left > 0)
    .map((g) => {
      const classFree = cells.filter((c) => !setOf(classBusy, g.classId).has(c.key));
      const reason = !classFree.length
        ? `${g.classLabel} has no free period left in the week.`
        : `${name(g.teacherId)} is busy in every period ${g.classLabel} still has free.`;
      return { classId: g.classId, classLabel: g.classLabel, subjectId: g.subjectId, subjectLabel: g.subjectLabel, teacherId: g.teacherId, count: g.left, reason };
    });
  const needed = rows.reduce((n, r) => n + r.remaining, 0);
  const assignments = [...new Map(groups.filter((g) => placements.some((p) => p.classId === g.classId && p.subjectId === g.subjectId && p.teacherId === g.teacherId)).map((g) => [`${g.classId}|${g.subjectId}`, { classId: g.classId, subjectId: g.subjectId, teacherId: g.teacherId }])).values()];
  return { placements, unplaced, needed, placed: placements.length, assignments };
}

/** Quality: fewer unplaced first, then fewer days where a subject repeats, then even teacher days. */
function cost(r: FillResult) {
  const repeat = new Map<string, number>();
  const tday = new Map<string, number>();
  for (const p of r.placements) {
    repeat.set(`${p.classId}|${p.subjectId}|${p.day}`, (repeat.get(`${p.classId}|${p.subjectId}|${p.day}`) || 0) + 1);
    tday.set(`${p.teacherId}|${p.day}`, (tday.get(`${p.teacherId}|${p.day}`) || 0) + 1);
  }
  let repeats = 0;
  for (const n of repeat.values()) if (n > 1) repeats += n - 1;
  let spread = 0;
  for (const n of tday.values()) spread += n * n;
  return (r.needed - r.placed) * 1_000_000 + repeats * 100 + spread / 100;
}

/** Fill every empty cell of every class. Tries several orders and keeps the best. */
export function fillTimetable(input: SolverInput, now: () => number = () => Date.now()): FillResult {
  const limit = input.timeLimitMs ?? 2500;
  const start = now();
  let best: FillResult | null = null;
  let seed = input.seed ?? 7;
  for (let i = 0; i < 40; i += 1) {
    const result = attempt(input, seed + i * 7919);
    if (!best || cost(result) < cost(best)) best = result;
    if (best.placed === best.needed && i >= 2) break;
    if (now() - start > limit) break;
  }
  return best!;
}
