import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportJobSummary } from "@reel-studio/shared-types";
import { applyStreamMessage, sortJobs, useExportJobs } from "./useExportJobs.js";

function job(id: string, overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id,
    batchId: "b1",
    batchIndex: 0,
    projectId: "p1",
    projectName: "My reel",
    output: { width: 1080, height: 1920, format: "mp4", label: null },
    downloadName: `${id}.mp4`,
    status: "queued",
    percent: 0,
    totalDurationSeconds: 10,
    errorMessage: null,
    warning: null,
    createdAt: 1000,
    startedAt: null,
    finishedAt: null,
    outputBytes: null,
    cost: 1,
    queuePosition: 1,
    queueRank: 0,
    ...overrides,
  };
}

describe("applyStreamMessage", () => {
  it("replaces everything on a snapshot, updates in place, inserts new jobs, drops removed ones", () => {
    let jobs = applyStreamMessage([], { type: "snapshot", jobs: [job("a", { queueRank: 1 }), job("b", { queueRank: 2 })] });
    expect(jobs.map((j) => j.id)).toEqual(["a", "b"]);
    jobs = applyStreamMessage(jobs, { type: "job", job: job("b", { status: "running", percent: 40 }), event: { type: "progress" } });
    expect(jobs[0]).toMatchObject({ id: "b", status: "running", percent: 40 }); // what's rendering comes first
    jobs = applyStreamMessage(jobs, { type: "job", job: job("c", { queueRank: 3 }), event: { type: "queued" } });
    expect(jobs.map((j) => j.id)).toEqual(["b", "a", "c"]);
    jobs = applyStreamMessage(jobs, { type: "removed", jobId: "a" });
    expect(jobs.map((j) => j.id)).toEqual(["b", "c"]);
  });
});

describe("sortJobs", () => {
  it("shows the running job, then the line in the order it will render, then history newest first", () => {
    const sorted = sortJobs([
      job("old-done", { status: "done", createdAt: 1000, batchIndex: 1 }),
      job("old-done-first", { status: "done", createdAt: 1000, batchIndex: 0 }),
      job("waiting-2nd", { status: "queued", queueRank: 20, queuePosition: 2 }),
      job("new-failed", { status: "error", createdAt: 5000 }),
      job("waiting-1st", { status: "queued", queueRank: 10, queuePosition: 1 }),
      job("running", { status: "running", queueRank: 5 }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(["running", "waiting-1st", "waiting-2nd", "new-failed", "old-done-first", "old-done"]);
  });

  it("follows a reorder: the line is by rank, not by when the jobs were created", () => {
    const moved = sortJobs([
      job("first-created", { status: "queued", createdAt: 1000, queueRank: 1 }),
      job("moved-to-front", { status: "queued", createdAt: 2000, queueRank: 0 }),
    ]);
    expect(moved.map((j) => j.id)).toEqual(["moved-to-front", "first-created"]);
  });
});

// A stand-in for the browser's EventSource that the test drives by hand.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe("useExportJobs", () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("subscribes to the project's stream, mirrors it, and re-subscribes when the project changes", () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useExportJobs(id), { initialProps: { id: "p1" } });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain("/render/events?projectId=p1");
    expect(result.current.connection).toBe("connecting");

    act(() => FakeEventSource.instances[0].onopen?.());
    expect(result.current.connection).toBe("live");
    act(() => FakeEventSource.instances[0].emit({ type: "snapshot", jobs: [job("a", { status: "running", percent: 12 })] }));
    expect(result.current.jobs).toHaveLength(1);
    act(() => FakeEventSource.instances[0].emit({ type: "job", job: job("a", { status: "done", percent: 100 }), event: { type: "done" } }));
    expect(result.current.jobs[0].status).toBe("done");

    act(() => FakeEventSource.instances[0].onerror?.());
    expect(result.current.connection).toBe("offline");

    rerender({ id: "p2" });
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toContain("projectId=p2");
    expect(result.current.jobs).toEqual([]);

    unmount();
    expect(FakeEventSource.instances[1].closed).toBe(true);
  });

  it("shows freshly started jobs before the stream catches up, and doesn't resurrect removed ones", async () => {
    const { result } = renderHook(() => useExportJobs("p1"));
    const stream = FakeEventSource.instances[0];
    act(() => stream.emit({ type: "snapshot", jobs: [] }));
    act(() => result.current.addJobs([job("new", { createdAt: 5000 })]));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["new"]);
    act(() => stream.emit({ type: "job", job: job("new", { createdAt: 5000, status: "running" }), event: { type: "started" } }));
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].status).toBe("running");

    act(() => result.current.remove("new"));
    expect(result.current.jobs).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/new"), { method: "DELETE" });
    // A progress message that was already on the wire must not bring it back.
    act(() => stream.emit({ type: "job", job: job("new", { status: "running", percent: 50 }), event: { type: "progress" } }));
    expect(result.current.jobs).toEqual([]);
  });

  it("cancels through the service and clears only what's finished", () => {
    const { result } = renderHook(() => useExportJobs("p1"));
    const stream = FakeEventSource.instances[0];
    act(() =>
      stream.emit({
        type: "snapshot",
        jobs: [job("running", { status: "running" }), job("done", { status: "done" }), job("failed", { status: "error" })],
      }),
    );
    act(() => result.current.cancel("running"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/running/cancel"), { method: "POST" });

    act(() => result.current.clearFinished());
    expect(result.current.jobs.map((j) => j.id)).toEqual(["running"]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/done"), { method: "DELETE" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/failed"), { method: "DELETE" });
  });

  it("retries through the service and swaps the replacement in where the old job was", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/render/failed/retry") && init?.method === "POST") {
        return new Response(JSON.stringify(job("replacement", { status: "queued", createdAt: 9000 })), { status: 202 });
      }
      if (url.endsWith("/render/gone/retry")) return new Response(JSON.stringify({ error: "files are gone" }), { status: 409 });
      return new Response("{}", { status: 200 });
    });
    const { result } = renderHook(() => useExportJobs(null));
    const stream = FakeEventSource.instances[0];
    expect(stream.url).toMatch(/\/render\/events$/); // no project filter: every job there is
    act(() => stream.emit({ type: "snapshot", jobs: [job("failed", { status: "error" }), job("gone", { status: "error" })] }));

    let message: string | null = "unset";
    await act(async () => {
      message = await result.current.retry("failed");
    });
    expect(message).toBeNull();
    expect(result.current.jobs.map((j) => j.id)).toEqual(["replacement", "gone"]);
    // A late message about the old job (already on the wire) must not bring it back.
    act(() => stream.emit({ type: "job", job: job("failed", { status: "error" }), event: { type: "error" } }));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["replacement", "gone"]);

    await act(async () => {
      message = await result.current.retry("gone");
    });
    expect(message).toBe("files are gone");
    expect(result.current.jobs.map((j) => j.id)).toEqual(["replacement", "gone"]);
  });

  it("moves a waiting job through the service and shows the line the service answers with", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/render/c/move") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ direction: "front" });
        return new Response(
          JSON.stringify({
            job: job("c", { queueRank: 0, queuePosition: 1 }),
            line: [job("c", { queueRank: 0, queuePosition: 1 }), job("b", { queueRank: 2, queuePosition: 2 })],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/render/a/move"))
        return new Response(JSON.stringify({ error: "Only an export that is still waiting in line can be moved." }), { status: 409 });
      return new Response("{}", { status: 200 });
    });
    const { result } = renderHook(() => useExportJobs("p1"));
    act(() =>
      FakeEventSource.instances[0].emit({
        type: "snapshot",
        jobs: [
          job("a", { status: "running", queueRank: 1, queuePosition: null }),
          job("b", { queueRank: 2, queuePosition: 1 }),
          job("c", { queueRank: 3, queuePosition: 2 }),
        ],
      }),
    );
    expect(result.current.jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
    let message: string | null = "unset";
    await act(async () => {
      message = await result.current.move("c", "front");
    });
    expect(message).toBeNull();
    expect(result.current.jobs.map((j) => [j.id, j.queuePosition])).toEqual([
      ["a", null],
      ["c", 1],
      ["b", 2],
    ]);
    await act(async () => {
      message = await result.current.move("a", "front");
    });
    expect(message).toContain("still waiting in line");
  });
});
