/** Edit verified CC0 source recordings into small reusable court Foley. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
fs.mkdirSync("public/assets/audio", { recursive: true });
const edits = [
  ["bounce-1", "ball-rebounds-1045", 0.11, 0.59],
  ["bounce-2", "ball-rebounds-1045", 3.05, 0.59],
  ["bounce-3", "ball-rebounds-1045", 5.85, 0.59],
  ["squeak-1", "basketball-shoes-0938", 0.12, 0.48],
  ["squeak-2", "basketball-shoes-0938", 4.83, 0.48],
  ["squeak-3", "basketball-shoes-0938", 8.6, 0.48],
  ["cheer", "crowd-cheer-0237", 0.28, 2.3],
];
for (const [name, source, start, length] of edits) {
  const out = "public/assets/audio/" + name + ".wav";
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(start),
    "-i",
    "assets/source/" + source + ".mp3",
    "-t",
    String(length),
    "-af",
    `highpass=f=45,lowpass=f=7500,afade=t=in:st=0:d=0.004,afade=t=out:st=${length - 0.13}:d=0.13`,
    "-ar",
    "24000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  // Normalise the actual PCM data to consistent headroom, keeping the fades.
  const bytes = fs.readFileSync(out);
  let offset = 12;
  while (offset + 8 < bytes.length) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === "data") break;
    offset += 8 + size + (size % 2);
  }
  const startByte = offset + 8,
    size = bytes.readUInt32LE(offset + 4);
  let peak = 0;
  for (let i = startByte; i < startByte + size; i += 2)
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  const gain = 24500 / Math.max(peak, 1);
  for (let i = startByte; i < startByte + size; i += 2)
    bytes.writeInt16LE(Math.round(bytes.readInt16LE(i) * gain), i);
  fs.writeFileSync(out, bytes);
}
console.log(
  JSON.stringify({
    recordings: edits.length,
    bytes: edits.reduce(
      (n, [name]) =>
        n + fs.statSync("public/assets/audio/" + name + ".wav").size,
      0,
    ),
  }),
);
