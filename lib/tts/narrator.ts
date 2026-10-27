"use client";

// Plays the document aloud chunk by chunk and reports which sentence and word
// are being spoken. Audio is synthesized at 1× and sped up with
// `playbackRate` (pitch preserved), so speed changes are instant and word
// timings stay valid in media time.

import { lastAtOrBefore, sentences } from "@/lib/pdf/segment";
import {
  buildChunk,
  chunkOffsetToPosition,
  chunkRangeToPages,
  type Chunk,
  type PageRange,
  type PageTextSource,
  type Position,
} from "./chunker";
import { MAX_RATE, MIN_RATE, type TimedWord, type TtsResponse } from "./types";

export interface Highlight {
  sentence: PageRange[];
  word: PageRange[];
  /** start of the current sentence; used to save progress */
  position: Position;
}

export interface NarratorState {
  playing: boolean;
  loading: boolean;
  ended: boolean;
}

export interface NarratorOptions {
  pageCount: number;
  getPage: PageTextSource;
  fetchTts: (text: string, voice: string, signal?: AbortSignal) => Promise<TtsResponse>;
  voice: string;
  rate: number;
  onState?: (s: NarratorState) => void;
  onHighlight?: (h: Highlight | null) => void;
  onError?: (message: string) => void;
}

const PREFETCH = 2;
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

interface Current {
  index: number;
  chunk: Chunk;
  words: TimedWord[];
}

export class Narrator {
  readonly audio: HTMLAudioElement;
  private chunks: Chunk[] = [];
  private startPos: Position = { page: 1, offset: 0 };
  private gen: Promise<unknown> = Promise.resolve();
  private tts = new Map<string, Promise<TtsResponse>>();
  private cur: Current | null = null;
  private token = 0;
  private raf = 0;
  private lastKey = "";
  private state: NarratorState = { playing: false, loading: false, ended: false };
  private unlocked = false;
  private wantPlay = false;
  private voice: string;
  private rate: number;

  constructor(private opts: NarratorOptions) {
    this.voice = opts.voice;
    this.rate = clampRate(opts.rate);
    const a = new Audio();
    a.preload = "auto";
    a.preservesPitch = true;
    a.defaultPlaybackRate = this.rate;
    a.playbackRate = this.rate;
    a.addEventListener("ended", this.onEnded);
    a.addEventListener("play", () => this.setState({ playing: true }));
    a.addEventListener("pause", () => this.setState({ playing: false }));
    a.addEventListener("seeked", () => this.tick(true));
    this.audio = a;
    this.setupMediaSession();
  }

  // ── public API ────────────────────────────────────────────────────────────

  get position(): Position | null {
    if (!this.cur) return null;
    const si = this.sentenceIndexAt(this.audio.currentTime);
    const s = this.cur.chunk.sentences[Math.max(0, si)];
    return chunkOffsetToPosition(this.cur.chunk, s ? s[0] : 0);
  }

  get isPlaying() {
    return this.state.playing;
  }

  /** Start reading at a position (e.g. a clicked sentence or saved progress). */
  async playFrom(pos: Position) {
    this.unlock();
    this.token++;
    this.chunks = [];
    this.cur = null;
    this.startPos = pos;
    this.gen = Promise.resolve();
    await this.playChunk(0, "start");
  }

  async play() {
    this.unlock();
    if (this.cur && !this.state.ended) {
      this.wantPlay = true;
      await this.audio.play().catch((e) => this.fail(e));
    } else {
      await this.playFrom(this.state.ended ? { page: 1, offset: 0 } : this.startPos);
    }
  }

  pause() {
    this.wantPlay = false;
    this.token++; // cancel pending loads
    this.setState({ loading: false });
    this.audio.pause();
  }

  toggle() {
    if (this.state.playing || this.state.loading) this.pause();
    else void this.play();
  }

  /** Set where play() starts when nothing has been played yet. */
  setStart(pos: Position) {
    if (!this.cur) this.startPos = pos;
  }

  setRate(rate: number) {
    this.rate = clampRate(rate);
    this.audio.defaultPlaybackRate = this.rate;
    this.audio.playbackRate = this.rate;
  }

  async setVoice(voice: string) {
    if (voice === this.voice) return;
    this.voice = voice;
    const pos = this.position;
    const wasPlaying = this.state.playing || this.state.loading;
    if (pos && wasPlaying) await this.playFrom(pos);
    else if (pos) {
      this.chunks = [];
      this.cur = null;
      this.startPos = pos;
    }
  }

  async nextSentence() {
    const c = this.cur;
    if (!c) return;
    const si = this.sentenceIndexAt(this.audio.currentTime);
    if (si + 1 < c.chunk.sentences.length) this.seekToSentence(si + 1);
    else await this.playChunk(c.index + 1, "start");
  }

  async prevSentence() {
    const c = this.cur;
    if (!c) return;
    const t = this.audio.currentTime;
    const si = Math.max(0, this.sentenceIndexAt(t));
    const startT = this.sentenceTime(si);
    if (t - startT > 1.5 * this.rate) return this.seekToSentence(si);
    if (si > 0) return this.seekToSentence(si - 1);
    if (c.index > 0) return this.playChunk(c.index - 1, "last");
    const prev = await this.previousSentencePosition(c.chunk.start);
    if (prev) await this.playFrom(prev);
    else this.seekToSentence(0);
  }

  skip(seconds: number) {
    if (!this.cur) return;
    const a = this.audio;
    const target = a.currentTime + seconds;
    if (target >= (a.duration || Infinity)) void this.playChunk(this.cur.index + 1, "start");
    else a.currentTime = Math.max(0, target);
  }

  destroy() {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.audio.pause();
    this.audio.removeEventListener("ended", this.onEnded);
    this.audio.removeAttribute("src");
    this.audio.load();
    if ("mediaSession" in navigator) {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"] as const) {
        navigator.mediaSession.setActionHandler(a, null);
      }
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private onEnded = () => {
    if (this.cur) void this.playChunk(this.cur.index + 1, "start");
  };

  /** Plays the browser-gesture-unlocked silent clip so later play() calls are allowed. */
  private unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const a = this.audio;
    if (!a.src) {
      a.src = SILENT_WAV;
      a.play().catch(() => undefined);
    }
  }

  private ensureChunk(i: number): Promise<Chunk | null> {
    const run = async (): Promise<Chunk | null> => {
      while (this.chunks.length <= i) {
        const last = this.chunks[this.chunks.length - 1];
        const pos = last ? last.next : this.startPos;
        if (!pos) return null;
        const c = await buildChunk(pos, this.opts.pageCount, this.opts.getPage);
        if (!c) return null;
        this.chunks.push(c);
      }
      return this.chunks[i];
    };
    const p = this.gen.then(run);
    this.gen = p.catch(() => undefined);
    return p;
  }

  private ttsFor(chunk: Chunk): Promise<TtsResponse> {
    const key = `${this.voice}|${chunk.key}`;
    let p = this.tts.get(key);
    if (!p) {
      p = this.opts.fetchTts(chunk.text, this.voice);
      this.tts.set(key, p);
      p.catch(() => this.tts.delete(key));
      if (this.tts.size > 40) this.tts.delete(this.tts.keys().next().value as string);
    }
    return p;
  }

  private async playChunk(index: number, at: "start" | "last") {
    const my = ++this.token;
    this.wantPlay = true;
    this.setState({ loading: true, ended: false });
    try {
      const chunk = await this.ensureChunk(index);
      if (my !== this.token) return;
      if (!chunk) {
        this.audio.pause();
        this.setState({ loading: false, playing: false, ended: true });
        this.opts.onHighlight?.(null);
        return;
      }
      const res = await this.ttsFor(chunk);
      if (my !== this.token) return;

      this.cur = { index, chunk, words: res.words };
      this.lastKey = "";
      const a = this.audio;
      a.src = res.audioUrl;
      a.defaultPlaybackRate = this.rate;
      a.playbackRate = this.rate;
      if (at === "last" && chunk.sentences.length > 1) {
        const t = this.sentenceTime(chunk.sentences.length - 1);
        await once(a, "loadedmetadata");
        if (my !== this.token) return;
        a.currentTime = t;
      }
      await a.play();
      if (!this.wantPlay) a.pause();
      if (my !== this.token) return;
      this.setState({ loading: false });
      this.loop();
      this.prefetch(index);
    } catch (e) {
      if (my === this.token) {
        this.setState({ loading: false });
        this.fail(e);
      }
    }
  }

  private prefetch(index: number) {
    for (let k = 1; k <= PREFETCH; k++) {
      this.ensureChunk(index + k)
        .then((c) => c && this.ttsFor(c))
        .catch(() => undefined);
    }
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    const step = () => {
      this.tick(false);
      if (!this.audio.paused) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };

  private wordIndexAt(t: number): number {
    return this.cur ? lastAtOrBefore(this.cur.words, t + 0.02, (w) => w.t) : -1;
  }

  private sentenceIndexAt(t: number): number {
    const c = this.cur;
    if (!c) return -1;
    const wi = this.wordIndexAt(t);
    if (wi < 0) return 0;
    return lastAtOrBefore(c.chunk.sentences, c.words[wi].s, (r) => r[0]);
  }

  private sentenceTime(si: number): number {
    const c = this.cur;
    if (!c) return 0;
    const start = c.chunk.sentences[si]?.[0] ?? 0;
    const w = c.words.find((w) => w.s >= start);
    return w ? Math.max(0, w.t - 0.05) : 0;
  }

  private seekToSentence(si: number) {
    this.audio.currentTime = this.sentenceTime(si);
    this.tick(true);
  }

  private tick(force: boolean) {
    const c = this.cur;
    if (!c) return;
    const t = this.audio.currentTime;
    const wi = this.wordIndexAt(t);
    const si = Math.max(0, this.sentenceIndexAt(t));
    const key = `${c.index}:${si}:${wi}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const sent = c.chunk.sentences[si];
    const word = wi >= 0 ? c.words[wi] : null;
    this.opts.onHighlight?.({
      sentence: sent ? chunkRangeToPages(c.chunk, sent[0], sent[1]) : [],
      word: word ? chunkRangeToPages(c.chunk, word.s, word.e) : [],
      position: chunkOffsetToPosition(c.chunk, sent ? sent[0] : 0),
    });
  }

  private async previousSentencePosition(pos: Position): Promise<Position | null> {
    for (let page = pos.page; page >= 1 && page >= pos.page - 5; page--) {
      const pt = await this.opts.getPage(page);
      const limit = page === pos.page ? pos.offset : Infinity;
      const before = sentences(pt.text).filter(([s]) => s < limit);
      if (before.length) return { page, offset: before[before.length - 1][0] };
    }
    return null;
  }

  private setState(patch: Partial<NarratorState>) {
    const next = { ...this.state, ...patch };
    if (next.playing === this.state.playing && next.loading === this.state.loading && next.ended === this.state.ended)
      return;
    this.state = next;
    this.opts.onState?.(next);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = next.playing ? "playing" : "paused";
    }
  }

  private fail(e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    const msg = e instanceof Error ? e.message : String(e);
    this.opts.onError?.(msg);
  }

  private setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => void this.play());
    ms.setActionHandler("pause", () => this.pause());
    ms.setActionHandler("previoustrack", () => void this.prevSentence());
    ms.setActionHandler("nexttrack", () => void this.nextSentence());
    ms.setActionHandler("seekbackward", () => this.skip(-10));
    ms.setActionHandler("seekforward", () => this.skip(10));
  }
}

export function clampRate(r: number) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 10) / 10));
}

function once(el: HTMLElement, event: string) {
  return new Promise<void>((resolve) => el.addEventListener(event, () => resolve(), { once: true }));
}
