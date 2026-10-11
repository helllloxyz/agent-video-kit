import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Resolve repository dependencies independently of the caller's working directory.
const sharedRequire = createRequire(new URL('../../.local-deps/video/package.json', import.meta.url));
export function dependency(name) {
  try { return sharedRequire(name); }
  catch (error) {
    throw new Error(`无法加载 ${name}；请在仓库根运行 npm ci --prefix .local-deps/video`, {cause: error});
  }
}
export const {createCanvas, GlobalFonts, loadImage} = dependency('@napi-rs/canvas');
export const ffmpeg = dependency('ffmpeg-static');
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
