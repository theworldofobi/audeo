"use client";

import { create } from "zustand";
import type { PageRange } from "@/lib/tts/chunker";
import { DEFAULT_VOICE } from "@/lib/tts/types";

export interface ReaderStore {
  playing: boolean;
  loading: boolean;
  ended: boolean;
  rate: number;
  voice: string;
  zoom: number;
  sentence: PageRange[];
  word: PageRange[];
  /** auto-scroll follows the voice until the user scrolls away */
  follow: boolean;
  currentPage: number;
  error: string | null;
  set: (patch: Partial<Omit<ReaderStore, "set">>) => void;
}

export const useReader = create<ReaderStore>((set) => ({
  playing: false,
  loading: false,
  ended: false,
  rate: 1,
  voice: DEFAULT_VOICE,
  zoom: 1,
  sentence: [],
  word: [],
  follow: true,
  currentPage: 1,
  error: null,
  set: (patch) => set(patch),
}));
