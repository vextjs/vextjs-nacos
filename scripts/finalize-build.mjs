import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(rootDir, "dist");
const cjsDir = path.join(rootDir, "dist-cjs");
const cjsSource = path.join(cjsDir, "index.js");
const cjsTarget = path.join(distDir, "index.cjs");

if (!existsSync(cjsSource)) {
  throw new Error(`CJS build output not found: ${cjsSource}`);
}

mkdirSync(distDir, { recursive: true });
cpSync(cjsSource, cjsTarget, { force: true });
rmSync(cjsDir, { recursive: true, force: true });

