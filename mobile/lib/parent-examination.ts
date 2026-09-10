export type ParentUpcomingPaper = {
  id: string;
  title: string;
  subject: string;
  date: string;
  time?: string;
  resultDate?: string;
  teacher: string;
  seriesId?: string;
  seriesName?: string;
};

function sittingFromTitle(title: string) {
  const t = String(title || "").trim();
  return (t.split(/\s*[·•|]\s*/)[0] || t).trim();
}

/** Parent timetable must use upcoming papers only — never the full examTimetable. */
export function parentUpcomingPapers<T>(data: { upcoming?: T[]; examTimetable?: T[] } | null | undefined): T[] {
  return data?.upcoming ?? [];
}

export function parentTimetableGroups(
  upcoming: ParentUpcomingPaper[],
  sessions: { id: string; name: string }[]
) {
  const groups = new Map<string, { id: string; name: string; papers: ParentUpcomingPaper[] }>();
  for (const exam of upcoming) {
    const id = exam.seriesId || exam.seriesName || sittingFromTitle(exam.title) || "other";
    const current = groups.get(id);
    if (current) current.papers.push(exam);
    else {
      groups.set(id, {
        id,
        name: exam.seriesName || sittingFromTitle(exam.title) || "Examination",
        papers: [exam],
      });
    }
  }
  const order = new Map(sessions.map((session, index) => [session.id, index]));
  return [...groups.values()]
    .filter((group) => group.papers.length > 0)
    .sort((a, b) => {
      const ai = order.has(a.id) ? order.get(a.id)! : 1000;
      const bi = order.has(b.id) ? order.get(b.id)! : 1000;
      if (ai !== bi) return ai - bi;
      return String(a.papers[0]?.date || "").localeCompare(String(b.papers[0]?.date || ""));
    });
}
