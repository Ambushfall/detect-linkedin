import { chromium } from 'playwright';



const browser = await chromium.launch({  // Or 'firefox' or 'webkit'.
  ignoreDefaultArgs: ['--mute-audio'],
  headless:false,
  executablePath: "C:\\Users\\colaf\\AppData\\Local\\Thorium\\Application\\thorium.exe"
});
const page = await browser.newPage();

// Quick probe: does this script contain a 32-char extension id?
const probePattern = /['"]([a-z]{32})['"]/;

// Storage for the raw fingerprinting data
let capturedData = null;

page.on('response', async (response) => {
    if (response.request().resourceType() === 'script') {
        console.log(response.request().url())
        try {
            const body = await response.text();

            // Quick check — skip files that don't contain an extension id
            if (!probePattern.test(body)) return;

            // Found a match — extract the enclosing array
            // Look for the array of {id, file} objects: [...{id:"...",file:"..."}...]
            const arrayMatch = body.match(/\[[\s\S]*?\{[^{}]*['"]?id['"]?\s*:\s*['"][a-z]{32}['"][^{}]*\}[\s\S]*?\]/);

            if (arrayMatch) {
                capturedData = arrayMatch[0];
                console.log(`\n[!] Fingerprinting array found at: ${response.url()}`);
                console.log(`[i] Captured ${capturedData.length} chars of raw data`);

                // Parse the captured array into structured data
                const objectPattern = /\{[^{}]*?\}/g;
                const idPattern = /['"]?id['"]?\s*:\s*['"]([a-z]{32})['"]/;
                const filePattern = /['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/;

                let objMatch;
                const extensions = [];

                while ((objMatch = objectPattern.exec(capturedData)) !== null) {
                    const obj = objMatch[0];
                    const idMatch = idPattern.exec(obj);
                    const fileMatch = filePattern.exec(obj);

                    if (idMatch && fileMatch) {
                        extensions.push({
                            extensionId: idMatch[1],
                            resourceFile: fileMatch[1]
                        });
                    }
                }

                console.log(`[i] Parsed ${extensions.length} extension entries`);
                console.table(extensions);
                await browser.close();
            }
        } catch (error) {
            // Ignore files that can't be read due to CORS
            console.log(error)
        }
    }
});

console.log("Navigating and scanning...");
await page.goto('https://www.linkedin.com/feed/');
