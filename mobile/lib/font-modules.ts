/** Web: react-native-web's Text is patched through its render function instead; no internals to load. */
export function nativeTextModules(): { Text: { default?: unknown }; TextInput: { default?: unknown } } | null {
  return null;
}
