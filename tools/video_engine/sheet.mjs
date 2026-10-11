import {readdirSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {createCanvas, loadImage} from './runtime.mjs';

const {values: v} = parseArgs({options: {
  'input-dir': {type: 'string'}, 'output-file': {type: 'string'}, prefix: {type: 'string', default: ''},
  cols: {type: 'string', default: '3'}, overwrite: {type: 'boolean'}, help: {type: 'boolean'},
}});
if (v.help) console.log('node tools/video_engine/sheet.mjs --input-dir DIR --output-file FILE [--prefix s01 --cols 3 --overwrite]');
else {
  try {
    if (!v['input-dir'] || !v['output-file']) throw new Error('必须指定 --input-dir 和 --output-file');
    const input = resolve(v['input-dir']), output = resolve(v['output-file']), cols = Number(v.cols);
    if (!Number.isInteger(cols) || cols < 1 || cols > 12) throw new Error('cols 必须为 1 到 12 的整数');
    if (existsSync(output) && !v.overwrite) throw new Error('输出文件已存在；使用新路径或 --overwrite');
    const files = readdirSync(input).filter((f) => f.startsWith(v.prefix) && f.toLowerCase().endsWith('.png')).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    if (!files.length) throw new Error('没有匹配的 PNG 静帧');
    const w = 640, h = 360, rows = Math.ceil(files.length / cols);
    const cv = createCanvas(cols * w, rows * h), c = cv.getContext('2d');
    c.fillStyle = '#0c0c0e'; c.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < files.length; i++) {
      const img = await loadImage(join(input, files[i]));
      c.drawImage(img, (i % cols) * w, Math.floor(i / cols) * h, w, h);
      c.fillStyle = '#ff0'; c.font = '20px sans-serif'; c.fillText(files[i], (i % cols) * w + 8, Math.floor(i / cols) * h + 22);
    }
    mkdirSync(dirname(output), {recursive: true}); writeFileSync(output, cv.toBuffer('image/png'));
    console.log(JSON.stringify({ok: true, file: output, images: files.length}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
