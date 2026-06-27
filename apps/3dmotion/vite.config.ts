import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const comfyInputDir = path.resolve(__dirname, '..', '..', '..', 'ComfyUI-scail', 'input');
const scailInputSubfolder = '3dmotion-scail';
const ffmpegPath = process.env.FFMPEG_PATH || 'C:\\Users\\AIBOX\\dev\\ffmpeg-8.0-full_build\\bin\\ffmpeg.exe';

function sanitizeVideoName(name: string) {
  return (name || 'drive.webm').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.[^.]+$/, '');
}

function convertToMp4(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outputPath,
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function scailDriveVideoPlugin() {
  return {
    name: 'scail-drive-video',
    configureServer(server) {
      server.middlewares.use('/api/scail-drive-video', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const baseName = sanitizeVideoName(url.searchParams.get('name') || 'drive.webm');
          const outputDir = path.join(comfyInputDir, scailInputSubfolder);
          await mkdir(outputDir, { recursive: true });
          const webmPath = path.join(outputDir, `${baseName}.webm`);
          const mp4Path = path.join(outputDir, `${baseName}.mp4`);
          await pipeline(req, createWriteStream(webmPath));
          await convertToMp4(webmPath, mp4Path);
          await rm(webmPath, { force: true });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ path: `${scailInputSubfolder}/${baseName}.mp4` }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/static/3dmotion/',
  build: {
    outDir: path.resolve(__dirname, '..', '..', 'frontend', '3dmotion'),
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
        entryFileNames: 'assets/index.js',
      },
    },
  },
  plugins: [react(), scailDriveVideoPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/comfy': {
        target: 'http://127.0.0.1:8188',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'http://127.0.0.1:8188');
            proxyReq.setHeader('Referer', 'http://127.0.0.1:8188/');
          });
        },
        rewrite: (path) => path.replace(/^\/comfy/, ''),
      },
    },
  },
});
