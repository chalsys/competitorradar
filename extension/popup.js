let currentTabUrl = "";
let scannedPosts = [];

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function normalizeProfileUrl(url) {
  const u = new URL(url);
  // Keep just the profile/company root, e.g. https://www.linkedin.com/company/acme
  const match = u.pathname.match(/^\/(company|in)\/[^/]+/);
  return `https://www.linkedin.com${match ? match[0] : u.pathname}`;
}

async function getSettings() {
  return chrome.storage.sync.get({ apiBase: "", apiToken: "", capturedBy: "" });
}

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("scan-btn").addEventListener("click", async () => {
  setStatus("Scanning…");
  document.getElementById("results").innerHTML = "";
  document.getElementById("log-btn").style.display = "none";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("linkedin.com")) {
    setStatus("Open a competitor's LinkedIn profile first.");
    return;
  }
  currentTabUrl = normalizeProfileUrl(tab.url);

  if (!document.getElementById("competitor-name").value) {
    document.getElementById("competitor-name").value = tab.title?.split(" | ")[0] || "";
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parser.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (typeof radarParseLinkedInPosts === "function" ? radarParseLinkedInPosts() : []),
    });
    scannedPosts = result || [];
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`);
    return;
  }

  if (scannedPosts.length === 0) {
    document.getElementById("results").innerHTML = `<div class="empty">No posts found. Scroll the profile to load some posts, then scan again.</div>`;
    setStatus("");
    return;
  }

  renderResults();
  setStatus(`Found ${scannedPosts.length} post(s). Review before logging — LinkedIn's markup shifts, so double-check the numbers.`);
  document.getElementById("log-btn").style.display = "block";
});

function renderResults() {
  const container = document.getElementById("results");
  container.innerHTML = scannedPosts
    .map(
      (p, i) => `
    <div class="post-item" data-index="${i}">
      <div class="top-row">
        <label><input type="checkbox" class="include-cb" checked /> Include</label>
        <select class="media-select">
          ${["text", "image", "video", "document", "poll"]
            .map((m) => `<option value="${m}" ${m === p.media_type ? "selected" : ""}>${m}</option>`)
            .join("")}
        </select>
      </div>
      <div class="snippet">${escapeHtml(p.text).slice(0, 140) || "<em>(no text captured)</em>"}</div>
      <div class="counts">
        <div><label>Likes</label><input type="number" class="likes-input" value="${p.likes}" /></div>
        <div><label>Comments</label><input type="number" class="comments-input" value="${p.comments}" /></div>
        <div><label>Reposts</label><input type="number" class="reposts-input" value="${p.reposts}" /></div>
      </div>
    </div>`
    )
    .join("");
}

document.getElementById("log-btn").addEventListener("click", async () => {
  const settings = await getSettings();
  if (!settings.apiBase || !settings.apiToken) {
    setStatus("Set the API URL and token in Settings first.");
    return;
  }
  const competitorName = document.getElementById("competitor-name").value.trim();
  const listName = document.getElementById("list-name").value.trim() || "Default";
  if (!competitorName) {
    setStatus("Enter the competitor's name.");
    return;
  }

  const items = [...document.querySelectorAll(".post-item")];
  const posts = items
    .filter((el) => el.querySelector(".include-cb").checked)
    .map((el) => {
      const i = Number(el.dataset.index);
      const original = scannedPosts[i];
      return {
        ...original,
        media_type: el.querySelector(".media-select").value,
        likes: Number(el.querySelector(".likes-input").value) || 0,
        comments: Number(el.querySelector(".comments-input").value) || 0,
        reposts: Number(el.querySelector(".reposts-input").value) || 0,
      };
    });

  if (posts.length === 0) {
    setStatus("Select at least one post to log.");
    return;
  }

  setStatus("Logging…");
  try {
    const res = await fetch(`${settings.apiBase.replace(/\/$/, "")}/api/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify({
        linkedin_url: currentTabUrl,
        competitor_name: competitorName,
        list_name: listName,
        captured_by: settings.capturedBy || "unknown",
        posts,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    setStatus(`Logged ✓ — ${data.created} new, ${data.updated} updated.`);
    document.getElementById("log-btn").style.display = "none";
  } catch (err) {
    setStatus(`Failed to log: ${err.message}`);
  }
});
