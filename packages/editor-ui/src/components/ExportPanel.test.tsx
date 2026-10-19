import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportJobSummary, ProjectModel } from "@reel-studio/shared-types";
import { saveMediaBlob } from "../persistence/db.js";
import { EditorProvider } from "../state/EditorContext.js";
import { createInitialProject, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { ExportPanel } from "./ExportPanel.js";

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

// jsdom's FormData refuses the Node Blob the test setup swaps in (see test/setup.ts), so uploads
// are recorded by this stand-in instead.
class FakeFormData {
  readonly entries = new Map<string, unknown>();
  append(name: string, value: unknown) {
    this.entries.set(name, value);
  }
  get(name: string) {
    return this.entries.get(name) ?? null;
  }
}

function projectWithClip(): ProjectModel {
  const project = createInitialProject();
  return {
    ...project,
    id: "proj-1",
    metadata: { ...project.metadata, name: "Beach day" },
    sources: [
      {
        id: "src-1",
        name: "clip.mp4",
        filePath: "",
        previewUrl: "",
        durationSeconds: 4,
        width: 1280,
        height: 720,
        kind: "video",
        isPlaceholder: false,
      },
    ],
    clips: [
      {
        id: "clip-1",
        sourceId: "src-1",
        trackId: VIDEO_TRACK_ID,
        label: "",
        inPoint: 0,
        outPoint: 4,
        timelineStart: 0,
        fitMode: "fit",
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        volume: 1,
        muted: false,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        speed: 1,
        opacity: 1,
        filter: { preset: null, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
        transitionOutSeconds: 0,
        transitionOutType: "dissolve",
        gapBeforeSeconds: 0,
      },
    ],
  };
}

function summary(id: string, overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id,
    batchId: "batch-1",
    batchIndex: 0,
    projectId: "proj-1",
    projectName: "Beach day",
    output: { width: 1080, height: 1920, format: "mp4", label: null },
    downloadName: "Beach day - 1080x1920.mp4",
    status: "queued",
    percent: 0,
    totalDurationSeconds: 4,
    errorMessage: null,
    warning: null,
    createdAt: 1000,
    startedAt: null,
    finishedAt: null,
    outputBytes: null,
    cost: 1,
    queuePosition: null,
    queueRank: 0,
    ...overrides,
  };
}

describe("ExportPanel", () => {
  const fetchMock = vi.fn();
  beforeEach(async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("FormData", FakeFormData);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    await saveMediaBlob("src-1", new Blob(["video-bytes"]));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends every output row in one upload and lists the jobs the service created", async () => {
    const created = [
      summary("job-mp4"),
      summary("job-gif", { output: { width: 720, height: 1280, format: "gif", label: null }, downloadName: "Beach day - 720x1280.gif" }),
    ];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/render") && init?.method === "POST") {
        return new Response(JSON.stringify({ batchId: "batch-1", jobId: "job-mp4", jobIds: ["job-mp4", "job-gif"], jobs: created }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    render(
      <EditorProvider initialProject={projectWithClip()}>
        <ExportPanel />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(FakeEventSource.instances[0].url).toContain("projectId=proj-1");

    // One row by default: 1080p MP4 at the canvas size.
    expect(screen.getByText(/1080×1920 · Beach day - 1080x1920\.mp4/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "+ Add another output" }));
    const qualities = screen.getAllByLabelText("Quality");
    const formats = screen.getAllByLabelText("Format");
    expect(qualities).toHaveLength(2);
    fireEvent.change(qualities[1], { target: { value: "720p" } });
    fireEvent.change(formats[1], { target: { value: "gif" } });
    expect(screen.getByText(/720×1280 · Beach day - 720x1280\.gif/)).toBeTruthy();
    expect(screen.getByText(/GIF has no sound/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Export 2 files" }));

    // First the panel asks what media the service already has (none: never saved), then it uploads.
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/render"))).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects\/proj-1\/media$/);
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/render")) as [string, RequestInit];
    expect(url).toMatch(/\/render$/);
    const form = init.body as unknown as FakeFormData;
    expect(JSON.parse(form.get("outputs") as string)).toEqual([
      { width: 1080, height: 1920, format: "mp4", label: null },
      { width: 720, height: 1280, format: "gif", label: null },
    ]);
    expect(JSON.parse(form.get("project") as string).id).toBe("proj-1");
    expect(form.get("media_src-1")).toBeInstanceOf(Blob);

    // The jobs appear straight away, then follow the stream.
    await screen.findByText("Beach day - 720x1280.gif");
    const stream = FakeEventSource.instances[0];
    act(() => stream.emit({ type: "job", job: summary("job-mp4", { status: "running", percent: 35 }), event: { type: "progress" } }));
    expect(screen.getByText("Rendering… 35%")).toBeTruthy();
    act(() =>
      stream.emit({
        type: "job",
        job: summary("job-mp4", { status: "done", percent: 100, outputBytes: 2_500_000 }),
        event: { type: "done" },
      }),
    );
    expect(screen.getByText("Done · 2.4 MB")).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download" }) as HTMLAnchorElement;
    expect(download.href).toContain("/render/job-mp4/result");
    expect(download.getAttribute("download")).toBe("Beach day - 1080x1920.mp4");
  });

  it("shows what the service still has after a reload, and the header button reflects it", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(
      <EditorProvider initialProject={projectWithClip()}>
        <ExportPanel />
      </EditorProvider>,
    );
    const stream = FakeEventSource.instances[0];
    act(() =>
      stream.emit({
        type: "snapshot",
        jobs: [
          summary("restored-running", { status: "running", percent: 62 }),
          summary("restored-queued", { status: "queued", queuePosition: 1, downloadName: "Beach day - 720x1280.webm" }),
          summary("restored-failed", {
            status: "error",
            errorMessage: "ffmpeg exited with code 1",
            downloadName: "Beach day - 540x960.mov",
          }),
        ],
      }),
    );
    expect(screen.getByRole("button", { name: "Exporting 2 · 62%" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Exporting 2 · 62%" }));
    const queue = screen.getByRole("list");
    expect(within(queue).getByText("Rendering… 62%")).toBeTruthy();
    expect(within(queue).getByText("Queued · #1 in line")).toBeTruthy();
    expect(within(queue).getByText("ffmpeg exited with code 1")).toBeTruthy();
    expect(within(queue).getAllByRole("button", { name: "Cancel" })).toHaveLength(2);

    fireEvent.click(within(queue).getAllByRole("button", { name: "Cancel" })[0]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/restored-running/cancel"), { method: "POST" });

    fireEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/render/restored-failed"), { method: "DELETE" });
    expect(within(queue).queryByText("Beach day - 540x960.mov")).toBeNull();

    act(() => stream.onerror?.());
    expect(screen.getByText(/Render service unreachable/)).toBeTruthy();
  });

  it("explains when the service can't be reached, without losing the output list", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <EditorProvider initialProject={projectWithClip()}>
        <ExportPanel />
      </EditorProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add another output" }));
    fireEvent.click(screen.getByRole("button", { name: "Export 2 files" }));
    await screen.findByText(/Couldn't reach the render service/);
    expect(screen.getAllByLabelText("Format")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Export 2 files" })).toBeTruthy();
  });
});
