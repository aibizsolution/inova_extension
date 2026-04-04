(function initHostedMeetingAudioChunker(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    DEFAULT_SOURCE_CHUNK_DURATION_MS,
    DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
    DEFAULT_SOURCE_CHUNK_SAMPLE_RATE,
    DEFAULT_SOURCE_MAX_BYTES,
    DEFAULT_SOURCE_MAX_DURATION_MS,
    normalizeText,
  } = ns.shared;

  async function prepareAudioSourceChunks(blob, options = {}) {
    const sourceBlob = blob instanceof global.Blob ? blob : null;
    if (!sourceBlob || Number(sourceBlob.size) <= 0) {
      throw new Error("오디오 원본이 비어 있어요.");
    }
    const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_SOURCE_MAX_BYTES);
    if (Number(sourceBlob.size) > maxBytes) {
      throw new Error(`현재 회의 원본은 ${(maxBytes / (1024 * 1024)).toFixed(0)}MB 이하까지만 지원해요.`);
    }
    const targetSampleRate = Math.max(8000, Number(options.targetSampleRate) || DEFAULT_SOURCE_CHUNK_SAMPLE_RATE);
    const chunkDurationMs = Math.max(30 * 1000, Number(options.chunkDurationMs) || DEFAULT_SOURCE_CHUNK_DURATION_MS);
    const overlapMs = Math.max(0, Number(options.overlapMs) || DEFAULT_SOURCE_CHUNK_OVERLAP_MS);
    const decoded = await decodeAudioBlob(sourceBlob);
    const monoSamples = downmixToMono(decoded);
    const resampled = resampleMono(monoSamples, decoded.sampleRate, targetSampleRate);
    const derivedDurationMs = Math.max(
      deriveAudioBufferDurationMs(decoded),
      Math.round((resampled.length / targetSampleRate) * 1000)
    );
    const maxDurationMs = Math.max(30 * 1000, Number(options.maxDurationMs) || DEFAULT_SOURCE_MAX_DURATION_MS);
    if (derivedDurationMs > maxDurationMs) {
      throw new Error("현재 회의 원본은 최대 2시간까지만 지원해요.");
    }

    const chunkSamples = Math.max(1, Math.floor((chunkDurationMs / 1000) * targetSampleRate));
    const overlapSamples = Math.min(chunkSamples - 1, Math.floor((overlapMs / 1000) * targetSampleRate));
    const stepSamples = Math.max(1, chunkSamples - overlapSamples);
    const parts = [];
    for (let startSample = 0; startSample < resampled.length; startSample += stepSamples) {
      const endSample = Math.min(resampled.length, startSample + chunkSamples);
      const pcm = resampled.subarray(startSample, endSample);
      const wavBuffer = encodeMonoWav16(pcm, targetSampleRate);
      parts.push({
        blob: new global.Blob([wavBuffer], { type: "audio/wav" }),
        endMs: Math.round((endSample / targetSampleRate) * 1000),
        overlapMs: startSample === 0 ? 0 : overlapMs,
        sizeBytes: wavBuffer.byteLength,
        startMs: Math.round((startSample / targetSampleRate) * 1000),
      });
      if (endSample >= resampled.length) {
        break;
      }
    }
    return {
      durationMs: Math.max(derivedDurationMs, Number(options.durationMs) || 0),
      mimeType: "audio/wav",
      parts,
      sampleRate: targetSampleRate,
    };
  }

  async function measureAudioDuration(blob) {
    const decoded = await decodeAudioBlob(blob);
    const durationMs = deriveAudioBufferDurationMs(decoded);
    if (!(durationMs > 0)) {
      throw new Error("decoded-duration-unavailable");
    }
    return durationMs;
  }

  async function decodeAudioBlob(blob) {
    const AudioContextCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("이 브라우저에서는 오디오 분할 준비를 지원하지 않아요.");
    }
    const context = new AudioContextCtor();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      return await context.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      throw new Error(`이 오디오 형식(${normalizeText(blob.type) || "unknown"})은 브라우저에서 바로 읽지 못했어요.`);
    } finally {
      try {
        await context.close();
      } catch {}
    }
  }

  function downmixToMono(audioBuffer) {
    const channelCount = Math.max(1, Number(audioBuffer?.numberOfChannels) || 1);
    const sampleCount = Math.max(0, Number(audioBuffer?.length) || 0);
    const mono = new Float32Array(sampleCount);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelData = audioBuffer.getChannelData(channelIndex);
      for (let index = 0; index < sampleCount; index += 1) {
        mono[index] += channelData[index] || 0;
      }
    }
    if (channelCount > 1) {
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] /= channelCount;
      }
    }
    return mono;
  }

  function deriveAudioBufferDurationMs(audioBuffer) {
    const sampleRate = Math.max(1, Number(audioBuffer?.sampleRate) || 0);
    const sampleLength = Math.max(0, Number(audioBuffer?.length) || 0);
    const durationFromSamples = sampleLength > 0 ? Math.round((sampleLength / sampleRate) * 1000) : 0;
    const durationFromMetadata = Math.round(Math.max(0, Number(audioBuffer?.duration) || 0) * 1000);
    return Math.max(durationFromSamples, durationFromMetadata);
  }

  function resampleMono(samples, inputSampleRate, outputSampleRate) {
    if (!samples.length || inputSampleRate === outputSampleRate) {
      return samples;
    }
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.max(1, Math.round(samples.length / ratio));
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const inputIndex = index * ratio;
      const lowerIndex = Math.floor(inputIndex);
      const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
      const mix = inputIndex - lowerIndex;
      output[index] = (samples[lowerIndex] || 0) * (1 - mix) + (samples[upperIndex] || 0) * mix;
    }
    return output;
  }

  function encodeMonoWav16(samples, sampleRate) {
    const dataLength = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataLength, true);
    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return buffer;
  }

  function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  ns.audioChunker = {
    measureAudioDuration,
    prepareAudioSourceChunks,
  };
})(globalThis);
