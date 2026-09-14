async function load() {
  const settings = await chrome.storage.sync.get({ apiBase: "", apiToken: "", capturedBy: "" });
  document.getElementById("api-base").value = settings.apiBase;
  document.getElementById("api-token").value = settings.apiToken;
  document.getElementById("captured-by").value = settings.capturedBy;
}

document.getElementById("save-btn").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiBase: document.getElementById("api-base").value.trim(),
    apiToken: document.getElementById("api-token").value.trim(),
    capturedBy: document.getElementById("captured-by").value.trim(),
  });
  const saved = document.getElementById("saved");
  saved.textContent = "Saved ✓";
  setTimeout(() => (saved.textContent = ""), 2000);
});

load();
