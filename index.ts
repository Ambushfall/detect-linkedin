import { chromium } from 'playwright';
import mongoose, { Schema, model } from 'mongoose';

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
async function fetchExtensionInfo(extensionId: string): Promise<{ extensionId: string; name: string | null; storeUrl: string | null }> {
  const storeUrl = `https://chromewebstore.google.com/detail/${extensionId}`;
  try {
    const pageRes = await fetch(storeUrl);
    const html = await pageRes.text();
    const titleMatch = html.match(/<title>([^<]+?)(?:\s*-\s*Chrome Web Store)?<\/title>/i);
    const name = titleMatch && titleMatch[1] && !titleMatch[1].includes('Chrome Web Store')
      ? titleMatch[1].trim()
      : null;
    return { extensionId, name, storeUrl };
  } catch {
    return { extensionId, name: '(fetch error)', storeUrl: null };
  }
}

// --- Main ---
const TARGET_URL = 'https://www.linkedin.com/feed/';
const {MONGO_USER, MONGO_PASS, MONGO_AUTH, MONGO_URI} = process.env

await mongoose.connect(MONGO_URI!, {
  authMechanism: "DEFAULT", authSource: MONGO_AUTH, auth: {username: MONGO_USER, password: MONGO_PASS}
});
console.log('[*] Connected to MongoDB');

const browser = await chromium.connectOverCDP('http://localhost:9222', { isLocal: true });
const page = await browser.newPage();

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
        for (const ext of foundExtensions) {
          console.log(`Fetching info for: ${ext.extensionId}`);
          const info = await fetchExtensionInfo(ext.extensionId);
          const now = new Date();
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
        }
      }
    } catch {
      // Ignore files that can't be read
    }
  }
});

console.log('Navigating and scanning...');
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
console.log('\n[*] Scan complete.\n');

page.on('close', async () => {
  console.log('[+] Browser closed');
  await mongoose.disconnect();
  process.exit(0);
});
