import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';

// --- Database setup ---
const DB_PATH = './detections.db';
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_url TEXT NOT NULL,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL,
        extension_id TEXT NOT NULL,
        resource_file TEXT NOT NULL,
        source_script_url TEXT NOT NULL,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (scan_id) REFERENCES scans(id)
    );

    CREATE TABLE IF NOT EXISTS extensions (
        extension_id TEXT PRIMARY KEY,
        name TEXT,
        version TEXT,
        store_url TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const insertScan = db.prepare(`INSERT INTO scans (scan_url) VALUES (?)`);
const insertDetection = db.prepare(`
    INSERT INTO detections (scan_id, extension_id, resource_file, source_script_url)
    VALUES (?, ?, ?, ?)
`);
const upsertExtension = db.prepare(`
    INSERT INTO extensions (extension_id, name, version, store_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(extension_id) DO UPDATE SET
        name = COALESCE(excluded.name, extensions.name),
        version = COALESCE(excluded.version, extensions.version),
        store_url = COALESCE(excluded.store_url, extensions.store_url),
        last_seen = datetime('now')
`);

// --- Chrome Web Store metadata fetcher ---
async function fetchExtensionInfo(extensionId) {
    const updateUrl = `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx2,crx3&prodversion=130.0&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;

    try {
        const res = await fetch(updateUrl);
        const xml = await res.text();
        // console.log(xml)
        // Parse version from the XML update response
        const versionMatch = xml.match(/version="([^"]+)"/);
        const version = versionMatch ? versionMatch[1] : null;

        // Check if the extension actually exists (status="ok" with an updatecheck that has a version)
        const exists = xml.includes('status="ok"') && version;

        const storeUrl = `https://chromewebstore.google.com/detail/${extensionId}`;

        // Try to get the name from the Chrome Web Store page
        let name = null;
        try {
            const pageRes = await fetch(storeUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const html = await pageRes.text();

            // Extract title from the page — Chrome Web Store puts it in <title>Name - Chrome Web Store</title>
            const titleMatch = html.match(/<title>([^<]+?)(?:\s*-\s*Chrome Web Store)?<\/title>/i);
            if (titleMatch && titleMatch[1] && !titleMatch[1].includes('Chrome Web Store')) {
                name = titleMatch[1].trim();
            }
        } catch {
            // Couldn't fetch the store page — not critical
        }

        return {
            extensionId,
            name: name || (exists ? '(unknown name)' : '(not found in store)'),
            version: version || 'unknown',
            storeUrl: exists ? storeUrl : null
        };
    } catch (error) {
        return {
            extensionId,
            name: '(fetch error)',
            version: 'unknown',
            storeUrl: null
        };
    }
}

// --- Main ---
const TARGET_URL = 'https://www.linkedin.com/feed/';

const browser = await chromium.connectOverCDP('http://localhost:9222', {
    isLocal: true
});
const page = await browser.newPage();

const extensionPattern = /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

// Create a scan record
const scanResult = insertScan.run(TARGET_URL);
const scanId = scanResult.lastInsertRowid;
console.log(`\n[*] Scan #${scanId} started for: ${TARGET_URL}`);

// Track unique extension IDs found in this scan
const foundExtensionIds = new Set();
const allDetections = [];

page.on('response', async (response) => {
    if (response.request().resourceType() === 'script' || response.url().endsWith('.js')) {
        try {
            const body = await response.text();

            let match;
            let foundExtensions = [];

            // Loop through all matches in the file
            while ((match = extensionPattern.exec(body)) !== null) {
                foundExtensions.push({
                    extensionId: match[1],
                    resourceFile: match[2]
                });
            }

            if (foundExtensions.length > 0) {
                console.log(`\n[!] Fingerprinting script found at: ${response.url()}`);
                // console.table(foundExtensions);
                const extensionDetails = [];
                for (const ext of foundExtensions) {
                    // Save detection to DB
                    insertDetection.run(scanId, ext.extensionId, ext.resourceFile, response.url());
                    foundExtensionIds.add(ext.extensionId);
                    allDetections.push({ ...ext, sourceUrl: response.url() });


                    console.log(`    Fetching info for: ${ext.extensionId}`);
                    const info = await fetchExtensionInfo(ext.extensionId);
                    extensionDetails.push(info);

                    // Upsert into extensions table
                    upsertExtension.run(info.extensionId, info.name, info.version, info.storeUrl);
                }
                console.log('\n[✓] Extension metadata:');
                console.table(extensionDetails[0]);
            }
        } catch (error) {
            // Ignore files that can't be read due to CORS
        }
    }
});

console.log("Navigating and scanning...");
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });


console.log(`\n[*] Results saved to: ${DB_PATH}`);
console.log(`[*] Scan #${scanId} complete.\n`);
page.on('close', () => {
    console.log("[+] Browser closed");
    db.close();
    process.exit(0);
});

