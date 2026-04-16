import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222', {  // Or 'firefox' or 'webkit'.
    isLocal: true
});
const page = await browser.newPage();

const extensionPattern = /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]\s*,\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/g;

page.on('response', async (response) => {
    if (response.request().resourceType() === 'script' || response.url().endsWith('.js')) {
        try {
            const body = await response.text();

            let match;
            let foundExtensions = [];

            // Loop through all matches in the file
            while ((match = extensionPattern.exec(body)) !== null) {
                foundExtensions.push({
                    extensionId: match[1], // Capture Group 1 (The 32-char ID)
                    resourceFile: match[2] // Capture Group 2 (The file path)
                });
            }

            if (foundExtensions.length > 0) {

                // await page.close();
                console.log(`\n[!] Fingerprinting script found at: ${response.url()}`);
                console.table(foundExtensions); // Prints a nice terminal table
            }
        } catch (error) {
            // Ignore files that can't be read due to CORS
        }
    }
});

console.log("Navigating and scanning...");
await page.goto('https://www.linkedin.com/feed/');
