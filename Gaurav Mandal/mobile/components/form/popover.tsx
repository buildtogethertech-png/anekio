import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Modal as RnModal, Pressable, View } from "react-native";

type Anchor = { x: number; y: number; width: number; height: number };
type Align = "start" | "end";

const GAP = 6;
const PAD = 10;
const DEFAULT_MAX_HEIGHT = 240;

function placePanel(
  anchor: Anchor,
  maxHeight: number,
  minWidth = 160,
  panelWidth?: number,
  align: Align = "start",
  fixedHeight?: number
) {
  const win = Dimensions.get("window");
  const width = Math.min(panelWidth ?? Math.max(anchor.width, minWidth), win.width - PAD * 2);
  let left = align === "end" ? anchor.x + anchor.width - width : anchor.x;
  left = Math.min(Math.max(PAD, left), win.width - width - PAD);

  const spaceBelow = win.height - PAD - (anchor.y + anchor.height + GAP);
  const spaceAbove = anchor.y - PAD - GAP;
  if (fixedHeight) {
    const height = Math.min(fixedHeight, win.height - PAD * 2);
    const below = anchor.y + anchor.height + GAP;
    const top = below + height <= win.height - PAD ? below : Math.max(PAD, anchor.y - height - GAP);
    return { left, top, width, maxHeight: height };
  }
  const needed = Math.min(maxHeight, 280);
  const placeBelow = spaceBelow >= needed || (spaceBelow > spaceAbove && spaceBelow >= 120);
  const room = Math.max(96, placeBelow ? spaceBelow : spaceAbove);
  const height = Math.min(maxHeight, room);
  const top = placeBelow ? anchor.y + anchor.height + GAP : Math.max(PAD, anchor.y - height - GAP);

  return { left, top, width, maxHeight: height };
}

export function Popover({
  open,
  onClose,
  panel,
  children,
  maxHeight = DEFAULT_MAX_HEIGHT,
  minWidth,
  width,
  align = "start",
  fixedHeight,
}: {
  open: boolean;
  onClose: () => void;
  panel: ReactNode;
  children: ReactNode;
  maxHeight?: number;
  minWidth?: number;
  width?: number;
  align?: Align;
  fixedHeight?: number;
}) {
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const measure = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      if (!w && !h) return;
      setAnchor({ x, y, width: w, height: h });
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const id = requestAnimationFrame(measure);
    const later = setTimeout(measure, 50);
    const sub = Dimensions.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(later);
      sub.remove();
    };
  }, [open, measure]);

  const box = anchor ? placePanel(anchor, maxHeight, minWidth, width, align, fixedHeight) : null;

  return (
    <View ref={triggerRef} collapsable={false}>
      {children}
      <RnModal visible={open} transparent animationType="none" onRequestClose={onClose}>
        <View className="flex-1">
          <Pressable className="absolute inset-0" onPress={onClose} />
          {box ? (
            <View
              className="overflow-hidden rounded-[10px] border border-ink-200 bg-white"
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                maxHeight: box.maxHeight,
                shadowColor: "#0f172a",
                shadowOpacity: 0.16,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
                elevation: 12,
              }}
            >
              {panel}
            </View>
          ) : null}
        </View>
      </RnModal>
    </View>
  );
}
