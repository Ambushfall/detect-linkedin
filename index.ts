import { chromium } from 'playwright';
import mongoose, { Schema, model } from 'mongoose';
import dotenv from "dotenv";

// Učitava .env fajl
let cfg = dotenv.config();

if(cfg.error) throw new Error(JSON.stringify(cfg.error))
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

// --- Chrome Web Store metadata fetcher ---
async function fetchExtensionInfo(
  extensionId: string,
): Promise<{ extensionId: string; name: string | null; storeUrl: string | null }> {
  const storeUrl = `https://chromewebstore.google.com/detail/${extensionId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const pageRes = await fetch(storeUrl, { signal: controller.signal });
    const html = await pageRes.text();
    const titleMatch = html.match(/<title>([^<]+?)(?:\s*-\s*Chrome Web Store)?<\/title>/i);
    const name = titleMatch && titleMatch[1] && !titleMatch[1].includes('Chrome Web Store')
      ? titleMatch[1].trim()
      : null;
    return { extensionId, name, storeUrl };
  } catch {
    return { extensionId, name: '(fetch error)', storeUrl: null };
  } finally {
    clearTimeout(timer);
  }
}

const MAX_RETRY_ATTEMPTS = 10;

type ExtensionState = 'pending' | 'fetching' | 'complete' | 'failed';

class ExtensionRecord {
  extensionId: string;
  resourceFile: string;
  sourceScriptUrl: string;
  attempts: number;
  state: ExtensionState;

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
    if (info.name !== '(fetch error)') {
      await Extension.findOneAndUpdate(
        { extensionId: this.extensionId },
        {
          $set: {
            resourceFile: this.resourceFile,
            sourceScriptUrl: this.sourceScriptUrl,
            name: info.name ?? undefined,
            storeUrl: info.storeUrl ?? undefined,
            lastSeen: now,
          },
          $setOnInsert: { firstSeen: now },
        },
        { upsert: true },
      );
      this.state = 'complete';
      console.log(`[✓] Complete: ${this.extensionId} (${info.name ?? 'unknown'})`);
    } else {
      this.state = 'failed';
      if (this.attempts >= MAX_RETRY_ATTEMPTS) {
        await Extension.findOneAndUpdate(
          { extensionId: this.extensionId },
          {
            $set: {
              resourceFile: this.resourceFile,
              sourceScriptUrl: this.sourceScriptUrl,
              name: '(fetch error)',
              lastSeen: now,
            },
            $setOnInsert: { firstSeen: now },
          },
          { upsert: true },
        );
        console.log(`[✗] Gave up: ${this.extensionId}`);
      } else {
        console.log(`[!] Failed (attempt ${this.attempts}): ${this.extensionId}`);
      }
    }
  }
}

const registry = new Map<string, ExtensionRecord>();
let activeHandlers = 0;
let scanDone = false;

async function runProcessor(): Promise<void> {
  while (true) {
    const next = [...registry.values()].find(r => r.isRetriable);
    if (!next) {
      if (scanDone && activeHandlers === 0) break;
      await new Promise(r => setTimeout(r, 50));
      continue;
    }
    await next.process();
    await new Promise(r => setTimeout(r, 100));
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
  { name: '(fetch error)' },
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
const processorDone = runProcessor();
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
console.log('\n[*] Scan complete. Waiting for processor to drain...\n');
scanDone = true;
await processorDone;
console.log('[*] All records processed.\n');

page.on('close', async () => {
  console.log('[+] Browser closed');
  await mongoose.disconnect();
  process.exit(0);
});
