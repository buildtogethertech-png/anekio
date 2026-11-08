/**
 * Features that ship separately.
 *
 * Teacher phones (the school-day overlay) is off in Play builds until it is released on its own.
 * To turn it on: build with EXPO_PUBLIC_TEACHER_PHONES=1 and remove "class-lock" from
 * "expo.autolinking.exclude" in package.json (that keeps the native overlay module, its permissions and
 * its service out of the Android app).
 */
export const FEATURES = {
  teacherPhones: process.env.EXPO_PUBLIC_TEACHER_PHONES === "1",
};
