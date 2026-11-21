import { createHash } from "node:crypto";

/**
 * Public Chromium key built into the SpeechRecognition library.
 * It is not a billed Google Cloud key. Google can revoke it at any time.
 */
const UNOFFICIAL_GOOGLE_SPEECH_KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw";
const GOOGLE_SPEECH_URL = "https://www.google.com/speech-api/v2/recognize";

type PcmWav = { rate: number; samples: Int16Array };

function readU16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function mulawToPcm(value: number): number {
  const byte = (~value) & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

/** Read a phone WAV (16-bit PCM or G.711 mu-law) into mono samples. */
export function readWavPcm(bytes: Uint8Array): PcmWav | null {
  if (bytes.length < 44) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF") return null;
  if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WAVE") return null;

  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = readU32(bytes, offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) return null;
    if (id === "fmt ") {
      format = readU16(bytes, start);
      channels = readU16(bytes, start + 2);
      rate = readU32(bytes, start + 4);
      bits = readU16(bytes, start + 14);
    } else if (id === "data") {
      data = bytes.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!data || !channels || rate < 8000 || rate > 48000) return null;
  if (format !== 1 && format !== 7) return null;

  const frame = format === 7 ? 1 : Math.max(1, bits / 8);
  const frames = Math.floor(data.length / (frame * channels));
  if (!frames || frames > 160_000) return null;
  const samples = new Int16Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const at = index * frame * channels;
    if (format === 7) samples[index] = mulawToPcm(data[at]);
    else if (bits === 8) samples[index] = (data[at] - 128) << 8;
    else samples[index] = (data[at] | (data[at + 1] << 8)) << 16 >> 16;
  }
  return { rate, samples };
}

function writeBits(parts: Array<[number, number]>): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let filled = 0;
  for (const [value, width] of parts) {
    for (let bit = width - 1; bit >= 0; bit -= 1) {
      acc = (acc << 1) | ((value >> bit) & 1);
      filled += 1;
      if (filled === 8) {
        bytes.push(acc & 0xff);
        acc = 0;
        filled = 0;
      }
    }
  }
  if (filled) bytes.push((acc << (8 - filled)) & 0xff);
  return Uint8Array.from(bytes);
}

function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function utf8FrameNumber(frame: number): number[] {
  if (frame < 128) return [frame];
  return [0x80 | (frame >> 7), 0x80 | (frame & 0x7f)];
}

function flacFrame(samples: Int16Array, offset: number, count: number, frame: number): Uint8Array {
  const blockCode = count === 4096 ? 12 : 7;
  const header = [
    0xff,
    0xf8,
    (blockCode << 4) | 0,
    0x08,
    ...utf8FrameNumber(frame),
    ...(blockCode === 7 ? [(count >> 8) & 0xff, count & 0xff] : []),
  ];
  const head = Uint8Array.from([...header, crc8(Uint8Array.from(header))]);
  const body = new Uint8Array(1 + count * 2);
  body[0] = 0x02;
  for (let index = 0; index < count; index += 1) {
    const sample = samples[offset + index];
    body[1 + index * 2] = (sample >> 8) & 0xff;
    body[2 + index * 2] = sample & 0xff;
  }
  const framed = new Uint8Array(head.length + body.length + 2);
  framed.set(head, 0);
  framed.set(body, head.length);
  const crc = crc16(framed.subarray(0, head.length + body.length));
  framed[framed.length - 2] = (crc >> 8) & 0xff;
  framed[framed.length - 1] = crc & 0xff;
  return framed;
}

/** Wrap signed 16-bit samples in a FLAC stream Google's unofficial endpoint accepts. */
export function pcmToFlac(samples: Int16Array, sampleRate: number): Uint8Array {
  const last = samples.length % 4096;
  const minBlock = !samples.length || last === 0 ? Math.min(4096, Math.max(samples.length, 1)) : last;
  const maxBlock = Math.min(4096, Math.max(samples.length, 1));
  const streamInfo = writeBits([
    [minBlock, 16],
    [maxBlock, 16],
    [0, 24],
    [0, 24],
    [sampleRate, 20],
    [0, 3],
    [15, 5],
    [Math.floor(samples.length / 2 ** 32), 4],
    [samples.length >>> 0, 32],
  ]);
  const md5 = createHash("md5")
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest();
  const info = new Uint8Array(4 + streamInfo.length + 16);
  info.set([0x80, 0x00, 0x00, 34], 0);
  info.set(streamInfo, 4);
  info.set(md5, 4 + streamInfo.length);

  const frames: Uint8Array[] = [];
  if (!samples.length) frames.push(flacFrame(new Int16Array(1), 0, 1, 0));
  for (let offset = 0, frame = 0; offset < samples.length; frame += 1) {
    const count = Math.min(4096, samples.length - offset);
    frames.push(flacFrame(samples, offset, count, frame));
    offset += count;
  }
  const size = 4 + info.length + frames.reduce((sum, frame) => sum + frame.length, 0);
  const out = new Uint8Array(size);
  out.set([0x66, 0x4c, 0x61, 0x43], 0);
  out.set(info, 4);
  let cursor = 4 + info.length;
  for (const frame of frames) {
    out.set(frame, cursor);
    cursor += frame.length;
  }
  return out;
}

function withSilence(pcm: PcmWav): Int16Array {
  const pad = Math.min(pcm.rate, 16_000);
  const out = new Int16Array(pad + pcm.samples.length + pad);
  out.set(pcm.samples, pad);
  return out;
}

export function googleTranscript(body: string): string | null {
  let transcript = "";
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const json = JSON.parse(trimmed) as { result?: Array<{ alternative?: Array<{ transcript?: string }> }> };
      const text = json.result?.[0]?.alternative?.[0]?.transcript?.trim() ?? "";
      if (text) transcript = text;
    } catch {
      return null;
    }
  }
  return transcript || null;
}

/** Transcribe a Yemot WAV with the unofficial Hebrew Google endpoint. Null means it was not available. */
export async function transcribeHebrew(wav: Uint8Array, timeoutMs = 8_000): Promise<string | null> {
  const pcm = readWavPcm(wav);
  if (!pcm) return null;
  const flac = pcmToFlac(withSilence(pcm), pcm.rate);
  const url = new URL(GOOGLE_SPEECH_URL);
  url.searchParams.set("client", "chromium");
  url.searchParams.set("lang", "he-IL");
  url.searchParams.set("key", UNOFFICIAL_GOOGLE_SPEECH_KEY);
  url.searchParams.set("pFilter", "0");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `audio/x-flac; rate=${pcm.rate}` },
      body: Buffer.from(flac),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (!response.ok) return null;
    return googleTranscript(await response.text());
  } catch {
    return null;
  }
}
