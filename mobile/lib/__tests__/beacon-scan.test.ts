import { matchSchoolBeacon, parseIBeacon, parseRotating } from "../beacon-scan";

const UUID = "8ec76ea3-6668-48da-9866-75be8bc86f4d";
const flat = UUID.replace(/-/g, "");

function b64(hex: string) {
  return Buffer.from(hex, "hex").toString("base64");
}

/** Apple iBeacon frame: 4C 00 02 15 <uuid> <major> <minor> <tx>. */
const frame = (uuidHex: string) => b64(`4c000215${uuidHex}00010002c5`);

describe("school beacon match", () => {
  it("reads an iBeacon frame", () => {
    expect(parseIBeacon(frame(flat))).toEqual({ uuid: UUID, major: 1, minor: 2, tx: -59 });
    expect(parseIBeacon(b64("0102"))).toBeNull();
  });

  it("matches the UUID in either byte order, or the name", () => {
    const want = { uuid: UUID, name: "Anekio-Gate-1" };
    expect(matchSchoolBeacon({ manufacturerData: frame(flat) }, want)).toBe("uuid");
    const reversed = flat.match(/../g)!.reverse().join("");
    expect(matchSchoolBeacon({ manufacturerData: frame(reversed) }, want)).toBe("uuid");
    expect(matchSchoolBeacon({ localName: "Anekio-Gate-1" }, want)).toBe("name");
    expect(matchSchoolBeacon({ name: "Other", manufacturerData: frame("11".repeat(16)) }, want)).toBeNull();
    expect(matchSchoolBeacon({ name: "" }, { uuid: UUID, name: "" })).toBeNull();
  });

  it("reads the rotating frame and, with the code on, matches only beacons that send it", () => {
    const rot = b64("ffff414b" + "a7f2c001" + "0000000c" + "1a2b3c4d");
    expect(parseRotating(rot)).toEqual({ boot: "a7f2c001", ctr: 12, code: "1a2b3c4d" });
    expect(parseRotating(frame(flat))).toBeNull();
    const want = { uuid: UUID, name: "Anekio-Gate-1", secure: true };
    expect(matchSchoolBeacon({ manufacturerData: rot, localName: "Anekio-Gate-1" }, want)).toBe("code");
    expect(matchSchoolBeacon({ manufacturerData: frame(flat), localName: "Anekio-Gate-1" }, want)).toBeNull();
    // Code off: the new beacon still matches by its name.
    expect(matchSchoolBeacon({ manufacturerData: rot, localName: "Anekio-Gate-1" }, { ...want, secure: false })).toBe("name");
  });
});
