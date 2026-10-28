import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const ready=existsSync(join(root,'.local-deps/video/node_modules/@napi-rs/canvas'));
test('custom caption drawing replaces default while preserving subtitle export',{skip:!ready},async()=>{
 const {createCanvas,loadImage}=await import('../tools/video_engine/runtime.mjs');
 const dir=mkdtempSync(join(tmpdir(),'video-custom-caption-'));
 try {
 const scene=join(dir,'scene.mjs');writeFileSync(scene,`export const duration=0.3;export const captions=[{start:0,end:.3,text:'formula caption'}];export const scenes=[{start:0,end:.3,beats:[0],chapter:'test',label:false,fadeIn:0,fadeOut:0,draw(){}}];export function drawCaption(c,cap,o){if(cap.text!=='formula caption'||o.top!==968)throw Error('bad caption contract');c.fillStyle='#ff0000';c.fillRect(0,o.top,o.width,70);c.globalAlpha=.01;}`);
 const render=join(root,'tools/video_engine/render.mjs');
 for(const mode of ['stills','full']){const r=spawnSync(process.execPath,[render,mode,'--scenes',scene,'--output-dir',dir,'--encoder','libx264'],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);}
 const im=await loadImage(readFileSync(join(dir,'stills/s01_b00.png'))),cv=createCanvas(1920,1080),ctx=cv.getContext('2d');ctx.drawImage(im,0,0);
 assert.deepEqual([...ctx.getImageData(960,1000,1,1).data],[255,0,0,255]);
 assert.match(readFileSync(join(dir,'字幕.srt'),'utf8'),/formula caption/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
