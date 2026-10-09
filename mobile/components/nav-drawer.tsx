import Ionicons from "@expo/vector-icons/Ionicons";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavMenu } from "./nav-menu";

type Drawer = { open: boolean; show: () => void; hide: () => void };

const DrawerContext = createContext<Drawer | null>(null);

export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DrawerContext.Provider value={{ open, show: () => setOpen(true), hide: () => setOpen(false) }}>
      {children}
      <NavDrawerOverlay />
    </DrawerContext.Provider>
  );
}

export function useNavDrawer() {
  return useContext(DrawerContext);
}

export function MenuButton() {
  const drawer = useNavDrawer();
  if (!drawer) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      onPress={drawer.show}
      className="h-10 w-10 items-center justify-center rounded-full"
    >
      <Ionicons name="menu-outline" size={24} color="#0f2744" />
    </Pressable>
  );
}

function NavDrawerOverlay() {
  const drawer = useNavDrawer();
  if (!drawer) return null;
  return (
    <Modal visible={drawer.open} transparent animationType="fade" onRequestClose={drawer.hide}>
      <View className="flex-1 flex-row">
        <View className="h-full w-4/5 bg-white">
          <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
            <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
              <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                <Image source={require("../assets/anekio-option-a.png")} accessibilityLabel="Anekio" style={{ width: 34, height: 34, borderRadius: 10 }} />
                <View>
                  <Text className="text-xl font-bold lowercase tracking-tight text-ink-900">anekio</Text>
                  <Text className="text-xs font-medium text-clay-600">Connecting school & parents</Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={drawer.hide}
                className="h-10 w-10 items-center justify-center rounded-full"
              >
                <Ionicons name="close" size={22} color="#0f2744" />
              </Pressable>
            </View>
            <NavMenu onNavigate={drawer.hide} />
          </SafeAreaView>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={drawer.hide}
          className="flex-1 bg-black/40"
        />
      </View>
    </Modal>
  );
}
