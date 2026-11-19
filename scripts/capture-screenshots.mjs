// Regenerates the README screenshots in docs/screenshots/ from a running TapComposer.
//
//   npm run build && npm start -- --port 3199        # in one terminal
//   npm i --no-save playwright                        # once; not a project dependency
//   BASE_URL=http://127.0.0.1:3199 node scripts/capture-screenshots.mjs
//   python3 scripts/optimize-screenshots.py           # optional: shrink PNGs (needs Pillow)
//
// Set CHROME_PATH to use an installed Chrome/Chromium instead of Playwright's bundled browser.
// All shots use the built-in "Take it for a spin" example song and a fresh, empty browser
// profile, so no personal data is involved. The microphone is not exercised.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const out = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

async function page(viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  const p = await context.newPage();
  await p.goto(base);
  return p;
}

async function loadExample(p) {
  await p.getByText("Take it for a spin.").first().click();
  await p.getByText("Arrange your song").waitFor();
  // The example starts playing on its own; stop it so the playhead is at 0:00.
  await p.getByRole("button", { name: /Stop playing/ }).first().click();
  await p.getByRole("button", { name: /Play my song/ }).waitFor();
  await p.waitForTimeout(600);
}

const shot = (p, name, options = {}) => p.screenshot({ path: `${out}${name}.png`, ...options });

// Desktop
{
  const p = await page({ width: 1280, height: 800 });
  await p.waitForTimeout(1500);
  await shot(p, "01-home");

  await p.getByRole("button", { name: /Hum an idea/ }).click();
  await p.getByRole("button", { name: /Start recording/ }).waitFor();
  await shot(p, "06-hum-recorder");
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: /Close/ }).click().catch(() => {});

  await loadExample(p);
  await shot(p, "02-song-workspace", { fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 1050 } });

  await p.getByRole("button", { name: /Volume & balance/ }).click();
  await p.getByText("Overall volume").waitFor();
  await p.waitForTimeout(400);
  await shot(p, "04-volume-balance", { fullPage: true, clip: { x: 0, y: 420, width: 1280, height: 720 } });
  await p.getByRole("button", { name: /Volume & balance/ }).click();

  await p.getByText("Piano example · 8 bars").first().click();
  await p.getByText("Note editor").waitFor();
  await p.waitForTimeout(500);
  await shot(p, "03-piano-roll", { fullPage: true, clip: { x: 0, y: 430, width: 1280, height: 1270 } });

  await p.getByRole("button", { name: /Show off/ }).click();
  await p.getByText("One little idea. A whole song.").waitFor();
  await p.getByRole("button", { name: /Play my song|Play/ }).first().click().catch(() => {});
  await p.waitForTimeout(1500);
  await shot(p, "05-show-off");

  await p.goto(`${base}/tuning`);
  await p.getByText("Fifteen little melodies").waitFor();
  await p.waitForTimeout(800);
  await shot(p, "07-tuning-center", { fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 1400 } });
}

// Mobile (iPhone-sized viewport)
{
  const p = await page({ width: 390, height: 844 }, true);
  await p.waitForTimeout(1500);
  await shot(p, "08-mobile-home");
  await loadExample(p);
  await shot(p, "09-mobile-song", { fullPage: true, clip: { x: 0, y: 0, width: 390, height: 1100 } });
}

await browser.close();
