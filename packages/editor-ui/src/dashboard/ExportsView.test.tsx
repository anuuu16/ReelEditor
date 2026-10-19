import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportJobSummary } from "@reel-studio/shared-types";
import { ExportsView } from "./ExportsView.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {}
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const NOW = 1_700_000_000_000;

function job(id: string, overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id,
    batchId: "b",
    batchIndex: 0,
    projectId: "p1",
    projectName: "Beach day",
    output: { width: 1080, height: 1920, format: "mp4", label: "Instagram Reel" },
    downloadName: `${id}.mp4`,
    status: "queued",
    percent: 0,
    totalDurationSeconds: 32,
    errorMessage: null,
    warning: null,
    createdAt: NOW - 60_000,
    startedAt: null,
    finishedAt: null,
    outputBytes: null,
    cost: 1,
    queuePosition: null,
    queueRank: 0,
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <ExportsView />
    </MemoryRouter>,
  );
}

describe("ExportsView", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("follows every project's exports with the details that matter, and cancels/removes/retries from here", async () => {
    renderView();
    expect(FakeEventSource.instances[0].url).toMatch(/\/render\/events$/);
    expect(screen.getByText(/Nothing has been exported yet/)).toBeTruthy();

    const stream = FakeEventSource.instances[0];
    act(() =>
      stream.emit({
        type: "snapshot",
        jobs: [
          job("running", { status: "running", percent: 40, startedAt: NOW - 30_000, createdAt: NOW - 40_000 }),
          job("done", {
            status: "done",
            percent: 100,
            outputBytes: 12_345_678,
            startedAt: NOW - 3_600_000 - 45_000,
            finishedAt: NOW - 3_600_000,
            projectName: "Other project",
            projectId: "p2",
            output: { width: 720, height: 1280, format: "gif", label: null },
            downloadName: "Other project - 720x1280.gif",
          }),
          job("failed", { status: "error", errorMessage: "ffmpeg exited with code 1", createdAt: NOW - 86_400_000 * 2 }),
        ],
      }),
    );
    expect(screen.getByText(/3 exports · 1 in progress · 11\.8 MB of finished files/)).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Rendering… 40%")).toBeTruthy();
    expect(within(rows[0]).getByText("1080×1920 MP4 · Instagram Reel · 32s reel · started just now")).toBeTruthy();
    expect(within(rows[1]).getByText("Done · 11.8 MB")).toBeTruthy();
    expect(within(rows[1]).getByText("720×1280 GIF · 32s reel · rendered in 45s · finished 1 h ago")).toBeTruthy();
    expect(within(rows[1]).getByText(/Other project ·/)).toBeTruthy();
    expect(within(rows[1]).getByRole("link", { name: "Download" }).getAttribute("download")).toBe("Other project - 720x1280.gif");
    expect(within(rows[2]).getByText("ffmpeg exited with code 1")).toBeTruthy();
    expect(within(rows[2]).getByText(/started 2 days ago/)).toBeTruthy();

    fireEvent.click(within(rows[0]).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/running/cancel"), { method: "POST" });
    expect(within(rows[0]).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(rows[1]).queryByRole("button", { name: "Retry" })).toBeNull();

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/render/failed/retry")) {
        return new Response(JSON.stringify(job("retried", { status: "queued", queuePosition: 1, createdAt: NOW })), { status: 202 });
      }
      return new Response("{}", { status: 200 });
    });
    fireEvent.click(within(rows[2]).getByRole("button", { name: "Retry" }));
    await screen.findByText("Queued · #1 in line");
    expect(screen.queryByText("ffmpeg exited with code 1")).toBeNull();
    // The replacement joins the line, right after what's rendering.
    expect(screen.getAllByRole("listitem").map((row) => row.textContent?.slice(0, 60))).toEqual([
      expect.stringContaining("running.mp4"),
      expect.stringContaining("retried.mp4"),
      expect.stringContaining("Other project - 720x1280.gif"),
    ]);
  });

  it("clears every completed export at once, after asking, and deletes each on the service", () => {
    renderView();
    const stream = FakeEventSource.instances[0];
    act(() =>
      stream.emit({
        type: "snapshot",
        jobs: [
          job("running", { status: "running", percent: 10 }),
          job("done", { status: "done", outputBytes: 5_000_000 }),
          job("cancelled", { status: "cancelled" }),
          job("failed", { status: "error" }),
        ],
      }),
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Clear all completed (3)" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Remove 3 completed exports and delete 4.8 MB from disk?"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear all completed (3)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    for (const id of ["done", "cancelled", "failed"]) {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/render/${id}`), { method: "DELETE" });
    }
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/render/running"), { method: "DELETE" });
    expect(screen.getByRole("button", { name: "Clear all completed (0)" })).toHaveProperty("disabled", true);
  });

  it("shows a failed retry's reason on the row, keeping the job", async () => {
    renderView();
    act(() => FakeEventSource.instances[0].emit({ type: "snapshot", jobs: [job("gone", { status: "cancelled" })] }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "The files this export was made from are no longer on the service" }), { status: 409 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/no longer on the service/);
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("offers move buttons on waiting jobs only, disabled at the ends of the line", async () => {
    renderView();
    act(() =>
      FakeEventSource.instances[0].emit({
        type: "snapshot",
        jobs: [
          job("running", { status: "running", queueRank: 1 }),
          job("first", { status: "queued", queueRank: 2, queuePosition: 1 }),
          job("last", { status: "queued", queueRank: 3, queuePosition: 2 }),
          job("done", { status: "done" }),
        ],
      }),
    );
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).queryByRole("group", { name: "Move in line" })).toBeNull();
    expect(within(rows[3]).queryByRole("group", { name: "Move in line" })).toBeNull();
    const first = within(rows[1]).getByRole("group", { name: "Move in line" });
    expect(within(first).getByRole("button", { name: "⇈ First" })).toHaveProperty("disabled", true);
    expect(within(first).getByRole("button", { name: "↑" })).toHaveProperty("disabled", true);
    expect(within(first).getByRole("button", { name: "↓" })).toHaveProperty("disabled", false);
    const last = within(rows[2]).getByRole("group", { name: "Move in line" });
    expect(within(last).getByRole("button", { name: "↓" })).toHaveProperty("disabled", true);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/render/last/move")) {
        return new Response(
          JSON.stringify({
            job: job("last", { status: "queued", queueRank: 0, queuePosition: 1 }),
            line: [
              job("last", { status: "queued", queueRank: 0, queuePosition: 1 }),
              job("first", { status: "queued", queueRank: 2, queuePosition: 2 }),
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    fireEvent.click(within(last).getByRole("button", { name: "⇈ First" }));
    await screen.findByText("Queued · #2 in line");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent?.slice(0, 30))).toEqual([
      expect.stringContaining("running.mp4"),
      expect.stringContaining("last.mp4"),
      expect.stringContaining("first.mp4"),
      expect.stringContaining("done.mp4"),
    ]);
  });

  it("shows a finished export's warning (a damaged source) next to its download", () => {
    renderView();
    act(() =>
      FakeEventSource.instances[0].emit({
        type: "snapshot",
        jobs: [job("iffy", { status: "done", outputBytes: 1000, warning: 'ffmpeg hit unreadable data in "beach.mp4" while rendering' })],
      }),
    );
    expect(screen.getByText(/unreadable data in "beach.mp4"/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
  });
});
