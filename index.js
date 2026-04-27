const express = require("express");
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// ─── Conversion Rules ────────────────────────────────────────────────────────
// Converts Selenium Java patterns to Playwright Java patterns
function convertToPlaywright(code) {
  return code
    // imports
    .replace(/import org\.openqa\.selenium\..+;/g, "// [converted] import com.microsoft.playwright.*;")
    .replace(/import org\.openqa\.selenium;/g, "// [converted] import com.microsoft.playwright.*;")

    // driver declaration & setup
    .replace(/WebDriver\s+(\w+)\s*=\s*new\s+\w+Driver\(\);/g,
      "Playwright playwright = Playwright.create();\n    Browser browser = playwright.chromium().launch();\n    Page $1 = browser.newPage();")
    .replace(/WebDriver driver/g, "Page page")

    // navigation
    .replace(/driver\.get\("([^"]+)"\)/g, 'page.navigate("$1")')
    .replace(/driver\.navigate\(\)\.to\("([^"]+)"\)/g, 'page.navigate("$1")')

    // finders → locators
    .replace(/driver\.findElement\(By\.id\("([^"]+)"\)\)/g,    'page.locator("#$1")')
    .replace(/driver\.findElement\(By\.name\("([^"]+)"\)\)/g,  'page.locator("[name=\'$1\']")')
    .replace(/driver\.findElement\(By\.xpath\("([^"]+)"\)\)/g, 'page.locator("xpath=$1")')
    .replace(/driver\.findElement\(By\.cssSelector\("([^"]+)"\)\)/g, 'page.locator("$1")')
    .replace(/driver\.findElement\(By\.className\("([^"]+)"\)\)/g, 'page.locator(".$1")')
    .replace(/driver\.findElement\(By\.tagName\("([^"]+)"\)\)/g, 'page.locator("$1")')
    .replace(/driver\.findElements\(/g, 'page.locator(')
    .replace(/driver\.findElement\(/g, 'page.locator(')

    // actions
    .replace(/\.sendKeys\("([^"]+)"\)/g, '.fill("$1")')
    .replace(/\.sendKeys\(/g, '.fill(')
    .replace(/\.click\(\)/g, '.click()')
    .replace(/\.clear\(\)/g, '.clear()')
    .replace(/\.getText\(\)/g, '.textContent()')
    .replace(/\.getAttribute\("([^"]+)"\)/g, '.getAttribute("$1")')
    .replace(/\.isDisplayed\(\)/g, '.isVisible()')
    .replace(/\.isEnabled\(\)/g, '.isEnabled()')
    .replace(/\.isSelected\(\)/g, '.isChecked()')
    .replace(/\.submit\(\)/g, '.press("Enter")')

    // waits
    .replace(/Thread\.sleep\(\d+\);/g, '// [converted] use page.waitForSelector() or Playwright auto-wait instead')
    .replace(/new WebDriverWait.+?;/g, '// [converted] Playwright has built-in auto-waiting')

    // assertions (TestNG → Playwright assertions)
    .replace(/Assert\.assertEquals\((.+?),\s*(.+?)\)/g, 'assertThat($1).hasText($2)')
    .replace(/Assert\.assertTrue\((.+?)\)/g, 'assertThat($1).isVisible()')

    // driver quit
    .replace(/driver\.quit\(\)/g, 'playwright.close()')
    .replace(/driver\.close\(\)/g, 'browser.close()');
}

// ─── Read a file from GitHub ─────────────────────────────────────────────────
async function readFileFromRepo(owner, repo, filePath) {
  try {
    const response = await octokit.repos.getContent({ owner, repo, path: filePath });
    const content = Buffer.from(response.data.content, "base64").toString("utf-8");
    return { success: true, content, sha: response.data.sha };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Write a converted file to GitHub ────────────────────────────────────────
async function writeFileToRepo(owner, repo, filePath, content, message) {
  try {
    // Check if file already exists (need SHA to update)
    let sha;
    try {
      const existing = await octokit.repos.getContent({ owner, repo, path: filePath });
      sha = existing.data.sha;
    } catch (_) {
      // File does not exist yet — that is fine
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString("base64"),
      ...(sha ? { sha } : {})
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Agent is running", usage: "POST /copilot or POST /convert" });
});

// Simple chat-style endpoint
app.post("/copilot", async (req, res) => {
  console.log("REQUEST /copilot:", req.body);
  const message = req.body.message || "";

  if (message.includes("convert")) {
    return res.json({
      response: "Use POST /convert with { owner, repo, filePath, targetOwner, targetRepo, targetPath }"
    });
  }

  res.json({ response: "Agent is running. Try: POST /convert" });
});

// Real conversion endpoint:
// Reads a Selenium Java file from sourceRepo, converts it, writes to targetRepo
app.post("/convert", async (req, res) => {
  console.log("REQUEST /convert:", req.body);

  const {
    owner,        // source repo owner
    repo,         // source repo name
    filePath,     // path to Selenium Java file in source repo
    targetOwner,  // target repo owner (for Playwright output)
    targetRepo,   // target repo name
    targetPath    // path to write converted file in target repo
  } = req.body;

  // Validate required fields
  if (!owner || !repo || !filePath) {
    return res.status(400).json({ error: "owner, repo, and filePath are required" });
  }

  // Step 1: read source file
  const source = await readFileFromRepo(owner, repo, filePath);
  if (!source.success) {
    return res.status(500).json({ error: "Failed to read source file", detail: source.error });
  }

  // Step 2: convert
  const converted = convertToPlaywright(source.content);

  // Step 3: write to target repo if provided, otherwise just return converted code
  if (targetOwner && targetRepo && targetPath) {
    const write = await writeFileToRepo(
      targetOwner,
      targetRepo,
      targetPath,
      converted,
      `migrate: convert ${filePath} from Selenium to Playwright`
    );
    if (!write.success) {
      return res.status(500).json({ error: "Failed to write target file", detail: write.error });
    }
    return res.json({
      success: true,
      message: `Converted and committed to ${targetOwner}/${targetRepo}/${targetPath}`,
      preview: converted.substring(0, 500) + (converted.length > 500 ? "\n... (truncated)" : "")
    });
  }

  // Return converted code only (no write)
  res.json({ success: true, converted });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log("Agent running on port 3000");
});
