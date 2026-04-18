#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "fixtures", "audio", "meeting-smoke-ko.wav");
const e2eDocPath = path.join(root, "docs", "e2e-browser-workflow.md");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readAscii(buffer, offset, length) {
  return buffer.toString("ascii", offset, offset + length);
}

function parseWav(buffer) {
  assert(buffer.length >= 44, "audio fixture is too small to be a WAV file");
  assert(readAscii(buffer, 0, 4) === "RIFF", "audio fixture must start with RIFF");
  assert(readAscii(buffer, 8, 4) === "WAVE", "audio fixture must be a WAVE file");

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    assert(chunkEnd <= buffer.length, `WAV chunk ${chunkId} exceeds file size`);

    if (chunkId === "fmt ") {
      assert(chunkSize >= 16, "WAV fmt chunk is too small");
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = { size: chunkSize, offset: chunkStart };
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  assert(fmt, "WAV fmt chunk is missing");
  assert(data, "WAV data chunk is missing");
  assert(fmt.byteRate > 0, "WAV byteRate must be positive");

  return {
    ...fmt,
    dataSize: data.size,
    durationSeconds: data.size / fmt.byteRate,
  };
}

function main() {
  assert(fs.existsSync(fixturePath), "meeting audio fixture is missing");

  const buffer = fs.readFileSync(fixturePath);
  const wav = parseWav(buffer);

  assert(buffer.length <= 1024 * 1024, "meeting audio fixture must stay below 1MB");
  assert(wav.audioFormat === 1, "meeting audio fixture must be PCM WAV");
  assert(wav.channels === 1, "meeting audio fixture must be mono");
  assert(wav.bitsPerSample === 16, "meeting audio fixture must be 16-bit");
  assert(wav.sampleRate >= 12000, "meeting audio fixture sample rate is too low");
  assert(wav.durationSeconds >= 3, "meeting audio fixture is too short for import smoke");
  assert(wav.durationSeconds <= 30, "meeting audio fixture must stay under 30 seconds");

  const e2eDoc = fs.readFileSync(e2eDocPath, "utf8");
  assert(
    e2eDoc.includes("fixtures/audio/meeting-smoke-ko.wav"),
    "e2e browser workflow must reference the meeting audio fixture"
  );

  console.log(
    `meeting audio fixture ok: ${path.relative(root, fixturePath)} ` +
      `${wav.durationSeconds.toFixed(2)}s ${wav.sampleRate}Hz ${wav.channels}ch ${buffer.length} bytes`
  );
}

main();
