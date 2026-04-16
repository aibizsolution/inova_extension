(function initHostedMeetingAudioChunker(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const {
    DEFAULT_SOURCE_BOUNDARY_ANALYSIS_STEP_MS,
    DEFAULT_SOURCE_BOUNDARY_ANALYSIS_WINDOW_MS,
    DEFAULT_SOURCE_BOUNDARY_SEARCH_WINDOW_MS,
    DEFAULT_SOURCE_CHUNK_DURATION_MS,
    DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
    DEFAULT_SOURCE_CHUNK_SAMPLE_RATE,
    DEFAULT_SOURCE_MAX_BYTES,
    DEFAULT_SOURCE_MAX_DURATION_MS,
    DEFAULT_SOURCE_TARGET_PART_BYTES,
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
    const boundaryAnalysisStepMs = Math.max(50, Number(options.boundaryAnalysisStepMs) || DEFAULT_SOURCE_BOUNDARY_ANALYSIS_STEP_MS);
    const boundaryAnalysisWindowMs = Math.max(50, Number(options.boundaryAnalysisWindowMs) || DEFAULT_SOURCE_BOUNDARY_ANALYSIS_WINDOW_MS);
    const boundarySearchWindowMs = Math.max(0, Number(options.boundarySearchWindowMs) || DEFAULT_SOURCE_BOUNDARY_SEARCH_WINDOW_MS);
    const targetPartBytes = Math.max(1024, Number(options.targetPartBytes) || DEFAULT_SOURCE_TARGET_PART_BYTES);
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

    const ranges = planAudioChunkRanges(resampled, targetSampleRate, {
      boundaryAnalysisStepMs,
      boundaryAnalysisWindowMs,
      boundarySearchWindowMs,
      chunkDurationMs,
      overlapMs,
      targetPartBytes,
    });
    const parts = [];
    for (const range of ranges) {
      const startSample = Math.max(0, Number(range.startSample) || 0);
      const endSample = Math.max(startSample, Number(range.endSample) || startSample);
      const pcm = resampled.subarray(startSample, endSample);
      const wavBuffer = encodeMonoWav16(pcm, targetSampleRate);
      parts.push({
        blob: new global.Blob([wavBuffer], { type: "audio/wav" }),
        endMs: Math.round((endSample / targetSampleRate) * 1000),
        overlapMs: Math.max(0, Number(range.overlapMs) || 0),
        sizeBytes: wavBuffer.byteLength,
        startMs: Math.round((startSample / targetSampleRate) * 1000),
      });
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

  function planAudioChunkRanges(samples, sampleRate, options = {}) {
    const sampleCount = Math.max(0, Number(samples?.length) || 0);
    if (!sampleCount) {
      return [];
    }
    const normalizedSampleRate = Math.max(1, Number(sampleRate) || 1);
    const chunkDurationMs = Math.max(30 * 1000, Number(options.chunkDurationMs) || DEFAULT_SOURCE_CHUNK_DURATION_MS);
    const overlapMs = Math.max(0, Number(options.overlapMs) || DEFAULT_SOURCE_CHUNK_OVERLAP_MS);
    const boundarySearchWindowMs = Math.max(0, Number(options.boundarySearchWindowMs) || DEFAULT_SOURCE_BOUNDARY_SEARCH_WINDOW_MS);
    const boundaryAnalysisWindowMs = Math.max(50, Number(options.boundaryAnalysisWindowMs) || DEFAULT_SOURCE_BOUNDARY_ANALYSIS_WINDOW_MS);
    const boundaryAnalysisStepMs = Math.max(50, Number(options.boundaryAnalysisStepMs) || DEFAULT_SOURCE_BOUNDARY_ANALYSIS_STEP_MS);
    const targetPartBytes = Math.max(1024, Number(options.targetPartBytes) || DEFAULT_SOURCE_TARGET_PART_BYTES);
    const chunkSamples = Math.max(1, Math.floor((chunkDurationMs / 1000) * normalizedSampleRate));
    const maxSamplesByBytes = Math.max(1, Math.floor((targetPartBytes - 44) / 2));
    const targetChunkSamples = Math.max(1, Math.min(chunkSamples, maxSamplesByBytes));
    const overlapSamples = Math.min(targetChunkSamples - 1, Math.floor((overlapMs / 1000) * normalizedSampleRate));
    const searchRadiusSamples = Math.max(0, Math.floor((boundarySearchWindowMs / 1000) * normalizedSampleRate));
    const analysisWindowSamples = Math.max(1, Math.floor((boundaryAnalysisWindowMs / 1000) * normalizedSampleRate));
    const analysisStepSamples = Math.max(1, Math.floor((boundaryAnalysisStepMs / 1000) * normalizedSampleRate));
    const ranges = [];
    let startSample = 0;
    while (startSample < sampleCount) {
      const maxEndSample = Math.min(sampleCount, startSample + Math.min(targetChunkSamples + searchRadiusSamples, maxSamplesByBytes));
      let endSample = sampleCount <= maxEndSample
        ? sampleCount
        : chooseLowEnergyBoundary(samples, {
            analysisStepSamples,
            analysisWindowSamples,
            idealEndSample: startSample + targetChunkSamples,
            maxEndSample,
            minEndSample: Math.max(startSample + 1, startSample + targetChunkSamples - searchRadiusSamples),
          });
      endSample = Math.max(startSample + 1, Math.min(sampleCount, Math.round(endSample)));
      ranges.push({
        endMs: Math.round((endSample / normalizedSampleRate) * 1000),
        endSample,
        overlapMs: startSample === 0 ? 0 : overlapMs,
        startMs: Math.round((startSample / normalizedSampleRate) * 1000),
        startSample,
      });
      if (endSample >= sampleCount) {
        break;
      }
      startSample = Math.max(startSample + 1, endSample - overlapSamples);
    }
    return ranges;
  }

  function chooseLowEnergyBoundary(samples, options = {}) {
    const minEndSample = Math.max(1, Number(options.minEndSample) || 1);
    const maxEndSample = Math.max(minEndSample, Number(options.maxEndSample) || minEndSample);
    const idealEndSample = Math.max(minEndSample, Math.min(maxEndSample, Number(options.idealEndSample) || minEndSample));
    const analysisWindowSamples = Math.max(1, Number(options.analysisWindowSamples) || 1);
    const analysisStepSamples = Math.max(1, Number(options.analysisStepSamples) || 1);
    const searchRadiusSamples = Math.max(1, Math.max(Math.abs(maxEndSample - idealEndSample), Math.abs(idealEndSample - minEndSample)));
    const candidates = new Set([Math.round(idealEndSample), Math.round(maxEndSample)]);
    for (let candidate = minEndSample; candidate <= maxEndSample; candidate += analysisStepSamples) {
      candidates.add(Math.round(candidate));
    }
    let bestSample = Math.round(idealEndSample);
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const normalizedCandidate = Math.max(minEndSample, Math.min(maxEndSample, Number(candidate) || idealEndSample));
      const rms = calculateWindowRootMeanSquare(samples, normalizedCandidate, analysisWindowSamples);
      const distance = Math.abs(normalizedCandidate - idealEndSample);
      const score = rms + (distance / searchRadiusSamples) * 0.005;
      if (score < bestScore || (score === bestScore && distance < bestDistance)) {
        bestDistance = distance;
        bestSample = normalizedCandidate;
        bestScore = score;
      }
    }
    return bestSample;
  }

  function calculateWindowRootMeanSquare(samples, centerSample, windowSamples) {
    const sampleCount = Math.max(0, Number(samples?.length) || 0);
    if (!sampleCount) {
      return 0;
    }
    const normalizedWindowSamples = Math.max(1, Number(windowSamples) || 1);
    const halfWindowSamples = Math.floor(normalizedWindowSamples / 2);
    const startSample = Math.max(0, Math.min(sampleCount - 1, Math.round(centerSample) - halfWindowSamples));
    const endSample = Math.min(sampleCount, startSample + normalizedWindowSamples);
    let total = 0;
    let count = 0;
    for (let index = startSample; index < endSample; index += 1) {
      const sample = Number(samples[index]) || 0;
      total += sample * sample;
      count += 1;
    }
    return count > 0 ? Math.sqrt(total / count) : 0;
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
    planAudioChunkRanges,
    prepareAudioSourceChunks,
  };
})(globalThis);
