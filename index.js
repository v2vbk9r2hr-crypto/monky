require("dotenv").config();
const express = require("express");
const { syncReportsToGoogleSheet } = require("./reportBot");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Report Bot is running");
});

app.get("/sync-report", async (req, res) => {
  try {
    const result = await syncReportsToGoogleSheet();
    res.json({
      ok: true,
      result
    });
  } catch (err) {
    console.error("sync-report error:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Report Bot running on port ${PORT}`);
});