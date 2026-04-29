import { chromium } from 'playwright';
import mongoose, { Schema, model } from 'mongoose';
import dotenv from "dotenv";

// Učitava .env fajl
let cfg = dotenv.config();

if(cfg.error) throw new Error(JSON.stringify(cfg.error))

const CONCURRENCY     = 10;
const REQUEST_TIMEOUT = 15_000;
const RETRY_COUNT     = 3;
const RETRY_DELAY     = 2_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// --- Mongoose model ---
interface IExtension {
  extensionId: string;
  resourceFile: string;
  sourceScriptUrl: string;
  name?: string;
  storeUrl?: string;
  firstSeen: Date;
  lastSeen: Date;
}

const extensionSchema = new Schema<IExtension>({
  extensionId: { type: String, required: true, unique: true },
  resourceFile: { type: String, required: true },
  sourceScriptUrl: { type: String, required: true },
  name: String,
  storeUrl: String,
  firstSeen: { type: Date, required: true },
  lastSeen: { type: Date, required: true },
});

const Extension = model<IExtension>('Extension', extensionSchema);

// --- Shared fetch headers ---
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

// --- HTML name parser ---
function parseName(html: string): string | null {
  const ogMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["'](.*?)["']/i,
  );
  if (ogMatch?.[1]?.trim()) return ogMatch[1].trim();

  const titleMatch = html.match(/<title>([^<]+?)<\/title>/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim().replace(/\s*-\s*Chrome Web Store\s*$/i, '').trim() || null;
  }
  return null;
}

// --- Chrome Web Store metadata fetcher ---
async function fetchExtensionInfo(extensionId: string): Promise<{
  extensionId: string;
  name: string;
  storeUrl: string | null;
  terminal: boolean;
}> {
  const storeUrl = `https://chromewebstore.google.com/detail/${extensionId}`;

  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const resp = await fetch(storeUrl, {
        headers: FETCH_HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 404) {
        return { extensionId, name: '[not found]', storeUrl: null, terminal: true };
      }
      if (resp.status === 429) {
        await sleep(RETRY_DELAY * (attempt + 2));
        continue;
      }
      if (resp.status !== 200) {
        return { extensionId, name: `[http ${resp.status}]`, storeUrl: null, terminal: true };
      }

      const html = await resp.text();
      const name = parseName(html) ?? '[parse failed]';
      return { extensionId, name, storeUrl, terminal: true };
    } catch {
      clearTimeout(timer);
      if (attempt < RETRY_COUNT - 1) await sleep(RETRY_DELAY);
    }
  }

  return { extensionId, name: '[error]', storeUrl: null, terminal: false };
}

const MAX_RETRY_ATTEMPTS = 10;

type ExtensionState = 'pending' | 'fetching' | 'complete' | 'failed';

let doneCount = 0;
let processorStart = 0;

const registry = new Map<string, ExtensionRecord>();

function logProgress(): void {
  const total = registry.size;
  if (total === 0) return;
  if (doneCount % 50 === 0 || doneCount === total) {
    const elapsed = (Date.now() - processorStart) / 1000;
    const rate = elapsed > 0 ? doneCount / elapsed : 0;
    const remaining = rate > 0 ? (total - doneCount) / rate : 0;
    console.log(
      `  ${doneCount}/${total} (${((doneCount / total) * 100).toFixed(1)}%)` +
      ` — ${rate.toFixed(1)} req/s — ~${remaining.toFixed(0)}s remaining`,
    );
  }
}

class ExtensionRecord {
  extensionId: string;
  resourceFile: string;
  sourceScriptUrl: string;
  attempts: number;
  state: ExtensionState;
  finalName?: string;

  constructor(
    extensionId: string,
    resourceFile: string,
    sourceScriptUrl: string,
    initialState: ExtensionState = 'pending',
    attempts = 0,
  ) {
    this.extensionId = extensionId;
    this.resourceFile = resourceFile;
    this.sourceScriptUrl = sourceScriptUrl;
    this.state = initialState;
    this.attempts = attempts;
  }

  get isRetriable(): boolean {
    return this.state === 'pending' ||
      (this.state === 'failed' && this.attempts < MAX_RETRY_ATTEMPTS);
  }

  async process(): Promise<void> {
    this.state = 'fetching';
    this.attempts++;
    const info = await fetchExtensionInfo(this.extensionId);
    const now = new Date();
    const isSuccess = !info.name.startsWith('[');

    if (isSuccess || info.terminal) {
      await Extension.findOneAndUpdate(
        { extensionId: this.extensionId },
        {
          $set: {
            resourceFile: this.resourceFile,
            sourceScriptUrl: this.sourceScriptUrl,
            name: info.name,
            storeUrl: isSuccess ? (info.storeUrl ?? undefined) : undefined,
            lastSeen: now,
          },
          $setOnInsert: { firstSeen: now },
        },
        { upsert: true },
      );
      this.state = 'complete';
      this.finalName = info.name;
      if (isSuccess) {
        console.log(`[✓] Complete: ${this.extensionId} (${info.name})`);
      } else {
        console.log(`[✗] Terminal: ${this.extensionId} (${info.name})`);
      }
    } else {
      this.state = 'failed';
      if (this.attempts >= MAX_RETRY_ATTEMPTS) {
        await Extension.findOneAndUpdate(
          { extensionId: this.extensionId },
          {
            $set: {
              resourceFile: this.resourceFile,
              sourceScriptUrl: this.sourceScriptUrl,
              name: info.name,
              lastSeen: now,
            },
            $setOnInsert: { firstSeen: now },
          },
          { upsert: true },
        );
        this.finalName = info.name;
        console.log(`[✗] Gave up: ${this.extensionId} (${info.name})`);
      } else {
        console.log(`[!] Failed (attempt ${this.attempts}): ${this.extensionId}`);
      }
    }
    doneCount++;
    logProgress();
  }
}

let activeHandlers = 0;
let scanDone = false;

async function runProcessor(): Promise<void> {
  while (true) {
    const next = [...registry.values()].find(r => r.isRetriable);
    if (!next) {
      const hasInflight = [...registry.values()].some(r => r.state === 'fetching');
      if (scanDone && activeHandlers === 0 && !hasInflight) break;
      await sleep(50);
      continue;
    }
    await next.process();
  }
}

// --- Main ---
const TARGET_URL = 'https://www.linkedin.com/';
const {MONGO_USER, MONGO_PASS, MONGO_AUTH, MONGO_URI} = process.env
console.log(MONGO_USER, MONGO_PASS, MONGO_AUTH, MONGO_URI)

await mongoose.connect(MONGO_URI!, {
  authMechanism: "DEFAULT", authSource: MONGO_AUTH, auth: {username: MONGO_USER, password: MONGO_PASS}
});
console.log('[*] Connected to MongoDB');

const failedDocs = await Extension.find(
  { name: { $in: ['(fetch error)', '[error]'] } },
  { extensionId: 1, resourceFile: 1, sourceScriptUrl: 1 },
).lean();
for (const doc of failedDocs) {
  registry.set(doc.extensionId, new ExtensionRecord(
    doc.extensionId, doc.resourceFile, doc.sourceScriptUrl, 'failed', 0,
  ));
}
console.log(`[*] Pre-loaded ${failedDocs.length} failed record(s) from DB`);

const browser = await chromium.connectOverCDP('http://localhost:9222', { isLocal: true });
const contexts = browser.contexts()
const pages = contexts.map(context => context.pages()).flat()
const page = pages.find(p => p.url().includes(TARGET_URL));
if (!page) {
    throw new Error(`No open tab found for URL: ${TARGET_URL}`);
}

const extensionPattern = /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

page.on('response', async (response) => {
  if (response.request().resourceType() === 'script' || response.url().endsWith('.js')) {
    activeHandlers++;
    try {
      const body = await response.text();
      const foundExtensions: { extensionId: string; resourceFile: string }[] = [];

      let match: RegExpExecArray | null;
      extensionPattern.lastIndex = 0;
      while ((match = extensionPattern.exec(body)) !== null) {
        foundExtensions.push({ extensionId: match[1], resourceFile: match[2] });
      }

      if (foundExtensions.length > 0) {
        console.log(`\n[!] Fingerprinting script found at: ${response.url()}`);
        for (const ext of foundExtensions) {
          const existing = registry.get(ext.extensionId);
          if (existing) {
            if (existing.state === 'complete') {
              // Already resolved — just refresh metadata
              await Extension.updateOne(
                { extensionId: ext.extensionId },
                { $set: { resourceFile: ext.resourceFile, sourceScriptUrl: response.url(), lastSeen: new Date() } },
              );
              console.log(`[=] Skipped (complete): ${ext.extensionId}`);
            } else {
              // In-flight or pending — update metadata on the record; processor will handle it
              existing.resourceFile = ext.resourceFile;
              existing.sourceScriptUrl = response.url();
              console.log(`[~] Updated metadata for in-progress: ${ext.extensionId}`);
            }
          } else {
            registry.set(ext.extensionId, new ExtensionRecord(ext.extensionId, ext.resourceFile, response.url()));
            console.log(`[+] Registered: ${ext.extensionId}`);
          }
        }
      }
    } catch {
      // Ignore files that can't be read
    } finally {
      activeHandlers--;
    }
  }
});

console.log('Navigating and scanning...');
processorStart = Date.now();
const processorDone = Promise.all(
  Array.from({ length: CONCURRENCY }, () => runProcessor()),
);
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
console.log('\n[*] Scan complete. Waiting for processor to drain...\n');
scanDone = true;
await processorDone;

const elapsed = ((Date.now() - processorStart) / 1000).toFixed(1);
const allRecords = [...registry.values()];
const named    = allRecords.filter(r => r.finalName && !r.finalName.startsWith('[')).length;
const notFound = allRecords.filter(r => r.finalName === '[not found]').length;
const errors   = allRecords.filter(r => r.finalName?.startsWith('[') && r.finalName !== '[not found]').length;
console.log(`[*] Done in ${elapsed}s`);
console.log(`    ${named} named, ${notFound} not found/removed, ${errors} errors`);
console.log('[*] All records processed.\n');

page.on('close', async () => {
  console.log('[+] Browser closed');
  await mongoose.disconnect();
  process.exit(0);
});
