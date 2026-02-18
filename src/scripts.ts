import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ScriptLoader {
  scriptLoad(script: string): Promise<string>;
}

export interface ScriptDef {
  sha: string;
  src: string;
}

export interface OmniqScripts {
  enqueue: ScriptDef;
  reserve: ScriptDef;
  ack_success: ScriptDef;
  ack_fail: ScriptDef;
  promote_delayed: ScriptDef;
  reap_expired: ScriptDef;
  heartbeat: ScriptDef;
  pause: ScriptDef;
  resume: ScriptDef;
  retry_failed: ScriptDef;
  retry_failed_batch: ScriptDef;
  remove_job: ScriptDef;
  remove_jobs_batch: ScriptDef;
  childs_init: ScriptDef;
  child_ack: ScriptDef;
}

function _importMetaUrl(): string | null {
  try {
    return new Function("return import.meta.url")() as string;
  } catch {
    return null;
  }
}

function moduleDirname(): string {
  const gd = (globalThis as any).__dirname;
  if (typeof gd === "string" && gd.length > 0) return gd;
  if (typeof __dirname === "string" && __dirname.length > 0) return __dirname;

  const imu = _importMetaUrl();
  if (!imu) return process.cwd();
  return path.dirname(fileURLToPath(imu));
}

function findPackageRoot(fromDir: string): string {
  let cur = fromDir;

  for (let i = 0; i < 25; i++) {
    const pj = path.join(cur, "package.json");
    if (fs.existsSync(pj)) return cur;

    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  throw new Error(
    `OmniQ: could not locate package.json starting from ${fromDir}. ` +
    `This is required to resolve dist/core/scripts deterministically.`
  );
}

export function defaultScriptsDir(): string {
  const env = process.env.OMNIQ_SCRIPTS_DIR;
  if (env && env.trim().length > 0) {
    const p = path.resolve(env.trim());
    if (!fs.existsSync(path.join(p, "enqueue.lua"))) {
      throw new Error(`OMNIQ_SCRIPTS_DIR is set but enqueue.lua was not found at: ${p}`);
    }
    return p;
  }

  const from = moduleDirname();
  const root = findPackageRoot(from);

  const distScripts = path.join(root, "dist", "core", "scripts");

  if (!fs.existsSync(path.join(distScripts, "enqueue.lua"))) {
    throw new Error(
      `OmniQ scripts not found at: ${distScripts}\n` +
      `Expected scripts to be copied into dist/core/scripts during build and published under dist/.\n` +
      `Hint: ensure your build copies scripts and package.json includes "files": ["dist", ...].`
    );
  }

  return distScripts;
}

async function loadOne(loader: ScriptLoader, scriptsDir: string, name: string): Promise<ScriptDef> {
  const p = path.join(scriptsDir, name);
  const src = fs.readFileSync(p, "utf8");
  const sha = await loader.scriptLoad(src);
  return { sha, src };
}

export async function loadScripts(loader: ScriptLoader, scriptsDir: string): Promise<OmniqScripts> {
  return {
    enqueue: await loadOne(loader, scriptsDir, "enqueue.lua"),
    reserve: await loadOne(loader, scriptsDir, "reserve.lua"),
    ack_success: await loadOne(loader, scriptsDir, "ack_success.lua"),
    ack_fail: await loadOne(loader, scriptsDir, "ack_fail.lua"),
    promote_delayed: await loadOne(loader, scriptsDir, "promote_delayed.lua"),
    reap_expired: await loadOne(loader, scriptsDir, "reap_expired.lua"),
    heartbeat: await loadOne(loader, scriptsDir, "heartbeat.lua"),
    pause: await loadOne(loader, scriptsDir, "pause.lua"),
    resume: await loadOne(loader, scriptsDir, "resume.lua"),
    retry_failed: await loadOne(loader, scriptsDir, "retry_failed.lua"),
    retry_failed_batch: await loadOne(loader, scriptsDir, "retry_failed_batch.lua"),
    remove_job: await loadOne(loader, scriptsDir, "remove_job.lua"),
    remove_jobs_batch: await loadOne(loader, scriptsDir, "remove_jobs_batch.lua"),
    childs_init: await loadOne(loader, scriptsDir, "childs_init.lua"),
    child_ack: await loadOne(loader, scriptsDir, "child_ack.lua"),
  };
}
