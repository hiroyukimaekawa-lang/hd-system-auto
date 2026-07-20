import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const screenshotArg = process.argv.find((value) => value.startsWith('--screenshots-dir='));

export const paths = {
  root,
  auth: path.join(root, '.auth', 'chrome'),
  inbox: path.join(root, 'data', 'inbox'),
  success: path.join(root, 'data', 'success'),
  failed: path.join(root, 'data', 'failed'),
  results: screenshotArg ? path.resolve(screenshotArg.slice('--screenshots-dir='.length)) : path.join(root, 'data', 'results'),
  work: path.join(root, '.work'),
  config: path.join(root, 'config.json')
};

export function ensureDirs() {
  Object.values(paths).filter((p) => !path.extname(p)).forEach((p) => fs.mkdirSync(p, { recursive: true }));
}

export function loadConfig() {
  return JSON.parse(fs.readFileSync(paths.config, 'utf8'));
}

export async function launch() {
  ensureDirs();
  return chromium.launchPersistentContext(paths.auth, {
    headless: String(process.env.HEADLESS).toLowerCase() === 'true',
    slowMo: Number(process.env.SLOW_MO || 100),
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  });
}

export function comdeskUrl() {
  return process.env.COMDESK_URL || 'https://app.comdesk.com/';
}

export async function firstVisible(page, candidates, timeout = 1500) {
  for (const candidate of candidates || []) {
    try {
      const locator = candidate.startsWith('role=')
        ? roleLocator(page, candidate)
        : candidate.startsWith('label=')
          ? page.getByLabel(toRegex(candidate.slice(6))).first()
          : candidate.startsWith('text=')
            ? page.getByText(toRegex(candidate.slice(5))).first()
            : page.locator(candidate).first();
      await locator.waitFor({ state: 'visible', timeout });
      return locator;
    } catch {}
  }
  return null;
}

function toRegex(value) {
  if (value.startsWith('/') && value.lastIndexOf('/') > 0) {
    const end = value.lastIndexOf('/');
    return new RegExp(value.slice(1, end), value.slice(end + 1));
  }
  return value;
}

function roleLocator(page, expression) {
  const match = expression.match(/^role=([^[]+)\[name=(\/.+\/[a-z]*)\]$/i);
  if (!match) return page.locator(expression);
  return page.getByRole(match[1].trim(), { name: toRegex(match[2]) }).first();
}

export async function screenshot(page, name) {
  const target = path.join(paths.results, `${Date.now()}_${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}
