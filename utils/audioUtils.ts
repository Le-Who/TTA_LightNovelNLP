/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// Decode base64 string to Uint8Array
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decode raw PCM data (from Gemini API) to AudioBuffer
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Concatenate multiple AudioBuffers into one
export function concatenateAudioBuffers(
  ctx: AudioContext,
  buffers: AudioBuffer[]
): AudioBuffer {
  // Guard clause for empty array or no context
  if (!buffers || buffers.length === 0) {
      // Return a 1-second silence buffer to prevent crash if absolutely needed, or a 0-length buffer
      return ctx.createBuffer(1, 1, 24000); 
  }

  const validBuffers = buffers.filter(b => b && b.length > 0);
  if (validBuffers.length === 0) {
      return ctx.createBuffer(1, 1, 24000);
  }

  const totalLength = validBuffers.reduce((acc, b) => acc + b.length, 0);
  const numberOfChannels = validBuffers[0].numberOfChannels;
  
  // Guard against 0 length total
  if (totalLength === 0) return ctx.createBuffer(1, 1, 24000);

  const result = ctx.createBuffer(numberOfChannels, totalLength, validBuffers[0].sampleRate);

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const resultData = result.getChannelData(channel);
    let offset = 0;
    for (const buffer of validBuffers) {
      resultData.set(buffer.getChannelData(channel), offset);
      offset += buffer.length;
    }
  }

  return result;
}

// Convert AudioBuffer to WAV Blob for download
export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // clamp
      sample = Math.max(-1, Math.min(1, channels[i][pos])); 
      // scale to 16-bit signed int
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; 
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArray], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(offset, data, true);
    offset += 2;
  }

  function setUint32(data: number) {
    view.setUint32(offset, data, true);
    offset += 4;
  }
}