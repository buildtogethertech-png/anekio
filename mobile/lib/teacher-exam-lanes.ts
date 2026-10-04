export type TeacherExamLane = "paper" | "take" | "marks" | "office" | "correction";

export function phoneLaneHeading(lane: TeacherExamLane) {
  if (lane === "take") return { title: "Exams to take", empty: "No exams to take", hint: "Nearest exams first." };
  if (lane === "marks") return { title: "Enter marks", empty: "No marks to enter", hint: "Papers waiting for your marks." };
  if (lane === "office") return { title: "Sent to office", empty: "Nothing sent to office", hint: "Marks already submitted." };
  if (lane === "correction") return { title: "Correction", empty: "No corrections", hint: "Returned by office." };
  return { title: "Papers to set", empty: "No papers to set", hint: "Paper, then take exam, then marks." };
}
