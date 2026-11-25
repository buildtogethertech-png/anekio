"""Case for the ESP32-C3 SuperMini (22.5 x 18 mm): a tray with a USB-C slot and a press-fit lid. Units: mm."""
import sys

OUT = sys.argv[1]

BOARD_L, BOARD_W = 22.5, 18.0
GAP = 0.75            # play around the board
WALL, FLOOR, TOP = 1.6, 1.2, 1.2
CAV_H = 7.0           # inside height (board + parts are ~3.5 mm, room for the plug)
IN_L, IN_W = BOARD_L + 2 * GAP, BOARD_W + 2 * GAP
OUT_L, OUT_W = IN_L + 2 * WALL, IN_W + 2 * WALL
SLOT_W = 12.5         # USB-C plug body fits through
LIP_H, LIP_T, FIT = 2.0, 1.2, 0.2

def cuboid(x0, y0, z0, x1, y1, z1):
    v = [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
    faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return [(v[a], v[b], v[c]) for a, b, c in faces]

def normal(t):
    (ax,ay,az),(bx,by,bz),(cx,cy,cz) = t
    ux,uy,uz = bx-ax,by-ay,bz-az; vx,vy,vz = cx-ax,cy-ay,cz-az
    n = (uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx)
    m = (n[0]**2+n[1]**2+n[2]**2) ** 0.5 or 1
    return tuple(c/m for c in n)

def write(path, name, boxes):
    tris = [t for b in boxes for t in cuboid(*b)]
    with open(path, "w") as f:
        f.write(f"solid {name}\n")
        for t in tris:
            n = normal(t)
            f.write(f" facet normal {n[0]:.4f} {n[1]:.4f} {n[2]:.4f}\n  outer loop\n")
            for p in t:
                f.write(f"   vertex {p[0]:.3f} {p[1]:.3f} {p[2]:.3f}\n")
            f.write("  endloop\n endfacet\n")
        f.write(f"endsolid {name}\n")
    return boxes

H = FLOOR + CAV_H
s0 = (OUT_W - SLOT_W) / 2
base = [
    (0, 0, 0, OUT_L, OUT_W, FLOOR),                              # floor
    (0, 0, FLOOR, OUT_L, WALL, H),                               # long side
    (0, OUT_W - WALL, FLOOR, OUT_L, OUT_W, H),                   # long side
    (OUT_L - WALL, WALL, FLOOR, OUT_L, OUT_W - WALL, H),         # closed end
    (0, WALL, FLOOR, WALL, s0, H),                               # USB end, left of the slot
    (0, s0 + SLOT_W, FLOOR, WALL, OUT_W - WALL, H),              # USB end, right of the slot
]
li0, lj0 = WALL + FIT, WALL + FIT
li1, lj1 = OUT_L - WALL - FIT, OUT_W - WALL - FIT
lid = [
    (0, 0, 0, OUT_L, OUT_W, TOP),                                # top plate (printed upside down)
    (li0, lj0, TOP, li1, lj0 + LIP_T, TOP + LIP_H),              # lip ring
    (li0, lj1 - LIP_T, TOP, li1, lj1, TOP + LIP_H),
    (li1 - LIP_T, lj0 + LIP_T, TOP, li1, lj1 - LIP_T, TOP + LIP_H),
    # USB end: lip stops at the slot so the plug still fits
    (li0, lj0 + LIP_T, TOP, li0 + LIP_T, s0, TOP + LIP_H),
    (li0, s0 + SLOT_W, TOP, li0 + LIP_T, lj1 - LIP_T, TOP + LIP_H),
]
write(f"{OUT}/anekio-beacon-base.stl", "anekio_beacon_base", base)
write(f"{OUT}/anekio-beacon-lid.stl", "anekio_beacon_lid", lid)
print(f"outside {OUT_L:.1f} x {OUT_W:.1f} x {H + TOP:.1f} mm, inside {IN_L:.1f} x {IN_W:.1f} x {CAV_H:.1f} mm, USB slot {SLOT_W} mm")
