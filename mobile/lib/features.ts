/**
 * Features that ship separately.
 *
 * Teacher phones (the school-day overlay) is on. To leave it out of a build, build with
 * EXPO_PUBLIC_TEACHER_PHONES=0 and add "class-lock" to "expo.autolinking.exclude" in package.json (that
 * keeps the native overlay module, its permissions and its service out of the Android app).
 */
export const FEATURES = {
  teacherPhones: process.env.EXPO_PUBLIC_TEACHER_PHONES !== "0",
};
