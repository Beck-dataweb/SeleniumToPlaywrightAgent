const express = require("express");
const { Octokit } = require("@octokit/rest");

const app = express();
app.use(express.json());

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Simple Selenium → Playwright Java conversion
function convertToPlaywright(code) {
  return code
    .replace(/WebDriver driver/g, "Playwright playwright")
    .replace(/driver\.get\(/g, "page.navigate(")
    .replace(/driver\.findElement/g, "page.locator")
    .replace(/sendKeys/g, "fill")
    .replace(/click\(\)/g, "click()");
}

app.post("/copilot", async (req, res) => {
  console.log("REQUEST:", req.body);

  const message = req.body.message || "";

  if (message.includes("convert")) {
    return res.json({
      response: "Conversion logic ready (next step: connect repos)"
    });
  }

  res.json({
    response: "Agent is running. Try: 'convert selenium test'"
  });
});

app.listen(3000, () => {
  console.log("Agent running on port 3000");
});
