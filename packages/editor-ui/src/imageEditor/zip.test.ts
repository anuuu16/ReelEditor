import { describe, expect, it } from "vitest";
import { crc32, createZip, dosDateTime } from "./zip.js";

const text = (s: string) => new TextEncoder().encode(s);

/** Enough of a ZIP reader to check what the writer produced — the spec's local/central/end records. */
function parseZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  expect(centralOffset + centralSize + 22).toBe(bytes.length);

  const entries: Array<{ name: string; data: Uint8Array; crc: number; method: number }> = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength;

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    entries.push({ name, data: bytes.subarray(dataStart, dataStart + size), crc, method });
  }
  return entries;
}

describe("crc32", () => {
  it("matches the standard check values", () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(text("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("dosDateTime", () => {
  it("packs a date the way ZIP headers expect (2-second resolution, 1980 epoch)", () => {
    const { date, time } = dosDateTime(new Date(2024, 5, 15, 13, 45, 31));
    expect(date >> 9).toBe(44); // 2024 - 1980
    expect((date >> 5) & 0xf).toBe(6);
    expect(date & 0x1f).toBe(15);
    expect(time >> 11).toBe(13);
    expect((time >> 5) & 0x3f).toBe(45);
    expect((time & 0x1f) * 2).toBe(30);
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0); // clamps to 1980
  });
});

describe("createZip", () => {
  it("writes a stored archive whose entries read back byte-for-byte", () => {
    const entries = [
      { name: "a.png", data: text("PNG-ish bytes"), modified: new Date(2024, 0, 1) },
      { name: "folder/b.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), modified: new Date(2024, 0, 1) },
      { name: "empty.txt", data: new Uint8Array(), modified: new Date(2024, 0, 1) },
    ];
    const parsed = parseZip(createZip(entries));
    expect(parsed.map((e) => e.name)).toEqual(["a.png", "folder/b.jpg", "empty.txt"]);
    parsed.forEach((entry, i) => {
      expect(Array.from(entry.data)).toEqual(Array.from(entries[i].data));
      expect(entry.crc).toBe(crc32(entries[i].data));
      expect(entry.method).toBe(0); // stored
    });
  });

  it("keeps UTF-8 names intact", () => {
    const [entry] = parseZip(createZip([{ name: "café – 写真.png", data: text("x") }]));
    expect(entry.name).toBe("café – 写真.png");
  });

  it("an empty archive is just the end-of-central-directory record", () => {
    const bytes = createZip([]);
    expect(bytes.length).toBe(22);
    expect(parseZip(bytes)).toEqual([]);
  });
});
