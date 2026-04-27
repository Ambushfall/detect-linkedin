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
const retryQueue: Array<{
  extensionId: string;
  resourceFile: string;
  sourceScriptUrl: string;
  attempts: number;
}> = [];

// --- Main ---
const TARGET_URL = 'https://www.linkedin.com/';
const {MONGO_USER, MONGO_PASS, MONGO_AUTH, MONGO_URI} = process.env
console.log(MONGO_USER, MONGO_PASS, MONGO_AUTH, MONGO_URI)

await mongoose.connect(MONGO_URI!, {
  authMechanism: "DEFAULT", authSource: MONGO_AUTH, auth: {username: MONGO_USER, password: MONGO_PASS}
});
console.log('[*] Connected to MongoDB');

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
        const ids = foundExtensions.map(e => e.extensionId);
        const existing = await Extension.find(
          { extensionId: { $in: ids }, name: { $nin: ['(fetch error)', null] } },
          { extensionId: 1 },
        ).lean();
        const knownIds = new Set(existing.map(e => e.extensionId));

        const now = new Date();
        await Promise.all(foundExtensions.map(async (ext) => {
          if (knownIds.has(ext.extensionId)) {
            await Extension.updateOne(
              { extensionId: ext.extensionId },
              { $set: { resourceFile: ext.resourceFile, sourceScriptUrl: response.url(), lastSeen: now } },
            );
            console.log(`[=] Skipped (known): ${ext.extensionId}`);
            return;
          }

          console.log(`Fetching info for: ${ext.extensionId}`);
          const info = await fetchExtensionInfo(ext.extensionId);
          if (info.name !== '(fetch error)') {
            await Extension.findOneAndUpdate(
              { extensionId: ext.extensionId },
              {
                $set: {
                  resourceFile: ext.resourceFile,
                  sourceScriptUrl: response.url(),
                  name: info.name ?? undefined,
                  storeUrl: info.storeUrl ?? undefined,
                  lastSeen: now,
                },
                $setOnInsert: { firstSeen: now },
              },
              { upsert: true },
            );
            console.log(`[✓] Upserted: ${ext.extensionId} (${info.name ?? 'unknown'})`);
          } else {
            retryQueue.push({
              extensionId: ext.extensionId,
              resourceFile: ext.resourceFile,
              sourceScriptUrl: response.url(),
              attempts: 1,
            });
            console.log(`[!] Queued for retry: ${ext.extensionId}`);
          }
        }));
      }
    } catch {
      // Ignore files that can't be read
    }
  }
});

console.log('Navigating and scanning...');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
console.log('\n[*] Scan complete.\n');

if (retryQueue.length > 0) {
  console.log(`[~] Draining retry queue (${retryQueue.length} items)...`);
  while (retryQueue.length > 0) {
    const item = retryQueue.shift()!;
    await new Promise(r => setTimeout(r, 100));
    console.log(`[~] Retry attempt ${item.attempts} for ${item.extensionId}`);
    const info = await fetchExtensionInfo(item.extensionId);
    const now = new Date();
    if (info.name !== '(fetch error)') {
      await Extension.findOneAndUpdate(
        { extensionId: item.extensionId },
        {
          $set: {
            resourceFile: item.resourceFile,
            sourceScriptUrl: item.sourceScriptUrl,
            name: info.name ?? undefined,
            storeUrl: info.storeUrl ?? undefined,
            lastSeen: now,
          },
          $setOnInsert: { firstSeen: now },
        },
        { upsert: true },
      );
      console.log(`[✓] Retry OK: ${item.extensionId} (${info.name ?? 'unknown'})`);
    } else if (item.attempts < MAX_RETRY_ATTEMPTS) {
      retryQueue.push({ ...item, attempts: item.attempts + 1 });
    } else {
      await Extension.findOneAndUpdate(
        { extensionId: item.extensionId },
        {
          $set: {
            resourceFile: item.resourceFile,
            sourceScriptUrl: item.sourceScriptUrl,
            name: '(fetch error)',
            lastSeen: now,
          },
          $setOnInsert: { firstSeen: now },
        },
        { upsert: true },
      );
      console.log(`[✗] Gave up: ${item.extensionId}`);
    }
  }
  console.log('[*] Retry queue drained.\n');
}

page.on('close', async () => {
  console.log('[+] Browser closed');
  await mongoose.disconnect();
  process.exit(0);
});
