import { describe, expect, it } from "vitest";
import { DEFAULT_DUCKING, migrateClip, migrateDucking } from "./timeline.js";
import { makeClipFixture } from "./test-fixtures.js";

describe("migrateClip", () => {
  it("leaves an already-current clip untouched", () => {
    const clip = makeClipFixture({ role: "voice", normalizeMode: "loudness" });
    expect(migrateClip(clip)).toEqual(clip);
  });

  it("defaults a clip with no role to music", () => {
    const clip = makeClipFixture();
    // @ts-expect-error simulating a persisted clip from before `role` existed
    delete clip.role;
    expect(migrateClip(clip).role).toBe("music");
  });

  it("maps the old boolean normalize flag onto normalizeMode", () => {
    const onClip = makeClipFixture();
    // @ts-expect-error simulating the old persisted shape
    delete onClip.normalizeMode;
    (onClip as unknown as { normalize: boolean }).normalize = true;
    expect(migrateClip(onClip).normalizeMode).toBe("peak");

    const offClip = makeClipFixture();
    // @ts-expect-error simulating the old persisted shape
    delete offClip.normalizeMode;
    (offClip as unknown as { normalize: boolean }).normalize = false;
    expect(migrateClip(offClip).normalizeMode).toBe("off");
  });
});

describe("migrateDucking", () => {
  it("fills in defaults entirely when missing", () => {
    expect(migrateDucking(undefined)).toEqual(DEFAULT_DUCKING);
  });

  it("fills in only the missing fields", () => {
    expect(migrateDucking({ enabled: true })).toEqual({ ...DEFAULT_DUCKING, enabled: true });
  });
});
