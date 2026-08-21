import express, { type Request, type Response, type Router } from "express";
import {
  fixPoemTimeline,
  generatePoem,
  generateReelCaption,
  generateReelCharacter,
  generateReelCover,
  generateReelMaster,
  generateReelScene,
  reworkPoem,
  type FixTimelineParams,
  type PoemParams,
  type ReelCaptionParams,
  type ReelCharacterParams,
  type ReelCoverParams,
  type ReelMasterParams,
  type ReelSceneParams,
  type ReworkParams,
} from "./rhymeGenerate.js";

// Every route here is a stateless generation call, same as /studio/:id/generate — persistence is
// the client's job (PATCH the poem/reel results into a Studio project's `poems` field), so the
// core generation path never depends on any storage at all.

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function sendGenerationError(res: Response, err: unknown) {
  console.error("Rhyme generation failed:", err);
  res.status(502).json({ error: "Generation failed, please try again." });
}

export function createRhymeRouter(): Router {
  const router = express.Router();

  router.post("/poem", async (req: Request, res: Response) => {
    const body = req.body as Partial<PoemParams>;
    if (!isNonEmptyString(body.topic)) {
      res.status(400).json({ error: "topic is required" });
      return;
    }
    const languages = Array.isArray(body.languages) ? body.languages.filter(isNonEmptyString) : [];
    if (languages.length === 0) {
      res.status(400).json({ error: "languages must be a non-empty array" });
      return;
    }
    const params: PoemParams = {
      topic: body.topic,
      age: body.age ?? "Preschool (4-6)",
      style: body.style ?? "Rhyme",
      lengthSeconds: Number(body.lengthSeconds) || 32,
      scenes: Math.max(1, Number(body.scenes) || 4),
      clipLengthSeconds: Math.max(1, Number(body.clipLengthSeconds) || 8),
      languages,
      contentType: body.contentType === "story" || body.contentType === "script" ? body.contentType : "poem",
      extra: body.extra,
      avoidTitles: Array.isArray(body.avoidTitles) ? body.avoidTitles.filter(isNonEmptyString) : undefined,
    };
    try {
      res.json(await generatePoem(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/poem/rework", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReworkParams>;
    const languages = Array.isArray(body.languages) ? body.languages.filter(isNonEmptyString) : [];
    if (!isNonEmptyString(body.topic) || !body.current || languages.length === 0) {
      res.status(400).json({ error: "topic, languages, and current poem are required" });
      return;
    }
    if (body.kind !== "regenerate" && body.kind !== "optimize" && body.kind !== "enhance") {
      res.status(400).json({ error: 'kind must be "regenerate", "optimize", or "enhance"' });
      return;
    }
    const params: ReworkParams = {
      topic: body.topic,
      age: body.age ?? "Preschool (4-6)",
      style: body.style ?? "Rhyme",
      lengthSeconds: Number(body.lengthSeconds) || 32,
      scenes: Math.max(1, Number(body.scenes) || 4),
      clipLengthSeconds: Math.max(1, Number(body.clipLengthSeconds) || 8),
      languages,
      contentType: body.contentType === "story" || body.contentType === "script" ? body.contentType : "poem",
      extra: body.extra,
      avoidTitles: Array.isArray(body.avoidTitles) ? body.avoidTitles.filter(isNonEmptyString) : undefined,
      kind: body.kind,
      current: body.current,
    };
    try {
      res.json(await reworkPoem(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  // Unlike /poem/rework, this never touches the words — poems/titles aren't even sent back, the
  // caller keeps its own verbatim and only applies the returned "scenes".
  router.post("/poem/fix-timeline", async (req: Request, res: Response) => {
    const body = req.body as Partial<FixTimelineParams>;
    const languages = Array.isArray(body.languages) ? body.languages.filter(isNonEmptyString) : [];
    if (!body.poems || typeof body.poems !== "object" || languages.length === 0) {
      res.status(400).json({ error: "poems and languages are required" });
      return;
    }
    const params: FixTimelineParams = {
      poems: body.poems,
      languages,
      scenes: Math.max(1, Number(body.scenes) || 4),
      lengthSeconds: Number(body.lengthSeconds) || 32,
      clipLengthSeconds: Math.max(1, Number(body.clipLengthSeconds) || 8),
    };
    try {
      res.json(await fixPoemTimeline(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/reel/master", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReelMasterParams>;
    const params: ReelMasterParams = { title: body.title, topic: body.topic, age: body.age ?? "Preschool (4-6)", poemText: body.poemText, aspectRatio: body.aspectRatio };
    try {
      res.json(await generateReelMaster(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/reel/scene", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReelSceneParams>;
    if (!isNonEmptyString(body.master) || !body.seg || !body.seg.lines || typeof body.seg.lines !== "object") {
      res.status(400).json({ error: "master and seg.lines are required" });
      return;
    }
    const params: ReelSceneParams = {
      master: body.master,
      seg: { lines: body.seg.lines, dur: Number(body.seg.dur) || 8 },
      idx: Number(body.idx) || 0,
      total: Number(body.total) || 1,
      primaryLanguage: body.primaryLanguage ?? Object.keys(body.seg.lines)[0] ?? "English",
      aspectRatio: body.aspectRatio,
    };
    try {
      res.json(await generateReelScene(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/reel/caption", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReelCaptionParams>;
    const params: ReelCaptionParams = { title: body.title, topic: body.topic, age: body.age ?? "Preschool (4-6)", poemText: body.poemText };
    try {
      res.json(await generateReelCaption(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/reel/character", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReelCharacterParams>;
    const params: ReelCharacterParams = { title: body.title, topic: body.topic, age: body.age ?? "Preschool (4-6)", poemText: body.poemText, master: body.master, aspectRatio: body.aspectRatio };
    try {
      res.json(await generateReelCharacter(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  router.post("/reel/cover", async (req: Request, res: Response) => {
    const body = req.body as Partial<ReelCoverParams>;
    const params: ReelCoverParams = { title: body.title, topic: body.topic, age: body.age ?? "Preschool (4-6)", poemText: body.poemText, master: body.master, aspectRatio: body.aspectRatio };
    try {
      res.json(await generateReelCover(params));
    } catch (err) {
      sendGenerationError(res, err);
    }
  });

  return router;
}
