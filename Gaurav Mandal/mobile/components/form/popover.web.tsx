import {
  autoPlacement,
  autoUpdate,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import type { CSSProperties, ReactNode } from "react";

type Align = "start" | "end";

const DEFAULT_MAX_HEIGHT = 240;

export function Popover({
  open,
  onClose,
  panel,
  children,
  maxHeight = DEFAULT_MAX_HEIGHT,
  minWidth,
  width,
  align = "start",
}: {
  open: boolean;
  onClose: () => void;
  panel: ReactNode;
  children: ReactNode;
  maxHeight?: number;
  minWidth?: number;
  width?: number;
  align?: Align;
}) {
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) onClose();
    },
    placement: align === "end" ? "bottom-end" : "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      autoPlacement({
        altBoundary: true,
        padding: 10,
        allowedPlacements:
          align === "end"
            ? ["bottom-end", "top-end", "bottom-start", "top-start"]
            : ["bottom-start", "top-start", "bottom-end", "top-end"],
      }),
      shift({ altBoundary: true, padding: 10 }),
      size({
        altBoundary: true,
        padding: 10,
        apply({ availableWidth, availableHeight, elements, rects }) {
          const nextWidth = width ?? Math.max(rects.reference.width, minWidth ?? 160);
          Object.assign(elements.floating.style, {
            width: `${Math.min(nextWidth, availableWidth)}px`,
            maxHeight: `${Math.max(120, Math.min(maxHeight, availableHeight))}px`,
          });
        },
      }),
    ],
  });

  const dismiss = useDismiss(context, { ancestorScroll: false });
  const role = useRole(context, { role: "listbox" });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  const panelStyle: CSSProperties = {
    ...floatingStyles,
    zIndex: 10050,
    overflow: "auto",
    overscrollBehavior: "contain",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.16)",
    visibility: isPositioned ? "visible" : "hidden",
  };

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} style={{ display: "block" }}>
        {children}
      </div>
      {open ? (
        <FloatingPortal>
          <div ref={refs.setFloating} {...getFloatingProps()} style={panelStyle}>
            {panel}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
