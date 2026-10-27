import "server-only";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { alignWords, type BoundaryEvent } from "./align";
import { buildSsml } from "./ssml";
import type { TimedWord } from "./types";

const TIMEOUT_MS = 45_000;

export interface SynthResult {
  audio: Buffer;
  words: TimedWord[];
  duration: number;
}

export function azureConfigured(): boolean {
  return Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
}

/** Synthesizes `text` with Azure neural TTS, returning MP3 bytes and word timings. */
export function synthesize(text: string, voice: string): Promise<SynthResult> {
  const config = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY!,
    process.env.AZURE_SPEECH_REGION!,
  );
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
  // Ask the service to send word boundary events.
  config.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary, "true");

  const { ssml, toTextOffset } = buildSsml(text, voice);
  // null audio config: keep audio in memory instead of playing it.
  const synth = new sdk.SpeechSynthesizer(config, null);
  const events: BoundaryEvent[] = [];

  synth.wordBoundary = (_s, e) => {
    if (e.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) return;
    events.push({
      offset: toTextOffset(e.textOffset),
      text: e.text,
      audioOffset: e.audioOffset,
      duration: e.duration,
    });
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      synth.close();
      fn();
    };
    // Never hold a request open forever on a stalled connection.
    const timer = setTimeout(
      () => finish(() => reject(new Error("Azure TTS timed out"))),
      TIMEOUT_MS,
    );

    synth.speakSsmlAsync(
      ssml,
      (result) =>
        finish(() => {
          if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
            const details = sdk.CancellationDetails.fromResult(result);
            reject(new Error(`Azure TTS failed: ${details?.errorDetails || sdk.ResultReason[result.reason]}`));
            return;
          }
          resolve({
            audio: Buffer.from(result.audioData),
            words: alignWords(text, events),
            duration: result.audioDuration / 10_000_000,
          });
        }),
      (err) => finish(() => reject(new Error(`Azure TTS failed: ${err}`))),
    );
  });
}
