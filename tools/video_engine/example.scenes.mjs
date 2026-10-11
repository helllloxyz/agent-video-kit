import {C, drawMath, drawText, line, dot, ramp} from './lib.mjs';

// A minimal, content-neutral scene. Replace it with the task's storyboard.
export const scenes = [{
  chapter: '示例：公式与图形',
  lines: ['用公式和图形表达同一个关系。'],
  draw(ctx, T) {
    const progress = ramp(T.b(0), 0, 0.8);
    drawText(ctx, '公式与图形', 960, 230, {size: 60, color: C.blue});
    drawMath(ctx, String.raw`f(x)=x^{2}`, 960, 450, {size: 80, prog: progress});
    line(ctx, 550, 750, 1370, 750, {color: C.grey, prog: progress});
    dot(ctx, 960, 750, 14, {color: C.yellow, alpha: progress});
  },
}];
