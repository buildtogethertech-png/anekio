/** Native only: React Native's own Text/TextInput modules, so lib/fonts can swap their default export. */
export function nativeTextModules(): { Text: { default?: unknown }; TextInput: { default?: unknown } } | null {
  return {
    Text: require("react-native/Libraries/Text/Text"),
    TextInput: require("react-native/Libraries/Components/TextInput/TextInput"),
  };
}
