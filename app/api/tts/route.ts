import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { azureConfigured, synthesize } from "@/lib/tts/azure";
import { mockSynthesize } from "@/lib/tts/mock";
import { MAX_TTS_CHARS, type TimedWord, type TtsResponse } from "@/lib/tts/types";
import { AUDIO_BUCKET, supabaseConfigured } from "@/lib/supabase/config";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/;
const SIGNED_URL_SECONDS = 60 * 60 * 6;
const isProd = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { text?: unknown; voice?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const voice = typeof body?.voice === "string" ? body.voice : "";
  if (!text.trim() || text.length > MAX_TTS_CHARS) {
    return NextResponse.json({ error: `text must be 1–${MAX_TTS_CHARS} characters` }, { status: 400 });
  }
  if (!VOICE_RE.test(voice)) {
    return NextResponse.json({ error: "unknown voice" }, { status: 400 });
  }

  // Only signed-in users may spend Azure characters.
  if (supabaseConfigured) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user && (isProd || azureConfigured())) {
      return NextResponse.json({ error: "Sign in to use the voice" }, { status: 401 });
    }
  } else if (isProd) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  if (!azureConfigured()) {
    if (isProd) return NextResponse.json({ error: "Azure Speech is not configured" }, { status: 503 });
    const m = mockSynthesize(text);
    return json({ audioUrl: dataUrl(m.audio, "audio/wav"), words: m.words, duration: m.duration, mock: true });
  }

  const hash = createHash("sha256").update(`${voice}|mp3-24k-48k|${text}`).digest("hex");
  const admin = supabaseAdmin();

  if (admin) {
    const { data: hit } = await admin
      .from("audio_cache")
      .select("storage_path, words, duration")
      .eq("hash", hash)
      .maybeSingle();
    if (hit) {
      const { data: signed } = await admin.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(hit.storage_path, SIGNED_URL_SECONDS);
      if (signed?.signedUrl) {
        return json({
          audioUrl: signed.signedUrl,
          words: hit.words as TimedWord[],
          duration: hit.duration ?? undefined,
          cached: true,
        });
      }
    }
  }

  let result;
  try {
    result = await synthesize(text, voice);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Voice synthesis failed. Check your Azure key and region." }, { status: 502 });
  }

  if (admin) {
    try {
      const path = `${hash.slice(0, 2)}/${hash}.mp3`;
      const up = await admin.storage
        .from(AUDIO_BUCKET)
        .upload(path, result.audio, { contentType: "audio/mpeg", upsert: true });
      if (up.error) throw up.error;
      await admin.from("audio_cache").upsert({
        hash,
        voice,
        storage_path: path,
        words: result.words,
        duration: result.duration,
        chars: text.length,
      });
      const { data: signed } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
      if (signed?.signedUrl) {
        return json({ audioUrl: signed.signedUrl, words: result.words, duration: result.duration });
      }
    } catch (e) {
      console.error("audio cache write failed", e);
    }
  }

  return json({ audioUrl: dataUrl(result.audio, "audio/mpeg"), words: result.words, duration: result.duration });
}

function json(body: TtsResponse) {
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

function dataUrl(buf: Buffer, mime: string) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
