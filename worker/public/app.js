const TOKEN_KEY = "radar_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    document.getElementById("token-gate").classList.remove("hidden");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.headers.get("content-type")?.includes("json") ? res.json() : res.text();
}

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

// --- Token gate ---
document.getElementById("token-save").addEventListener("click", () => {
  const val = document.getElementById("token-input").value.trim();
  if (!val) return;
  localStorage.setItem(TOKEN_KEY, val);
  document.getElementById("token-gate").classList.add("hidden");
  init();
});
// Token gate temporarily disabled — see isAuthorized() in worker/src/index.ts.

// --- Feed ---
const mediaEmoji = { text: "📝", image: "🖼️", video: "🎥", document: "📄", poll: "📊" };

function renderPosts(posts) {
  const list = document.getElementById("post-list");
  if (posts.length === 0) {
    list.innerHTML = `<div class="empty-state">No posts clear these filters yet. Loosen the thresholds, or log a competitor's posts with the Capture Assistant extension.</div>`;
    return;
  }
  list.innerHTML = posts
    .map(
      (p) => `
    <div class="post-card" data-id="${p.id}">
      <div class="post-main">
        <div class="post-competitor">${escapeHtml(p.competitor_name)} <span class="badge">${mediaEmoji[p.media_type] || ""} ${p.media_type}</span></div>
        <div class="post-meta">Posted ${p.posted_at ? new Date(p.posted_at).toLocaleDateString() : "—"} · captured by ${escapeHtml(p.captured_by || "—")}</div>
        <div class="post-text">${escapeHtml(p.text).slice(0, 400)}${p.text.length > 400 ? "…" : ""}</div>
        <a class="post-link" href="${escapeHtml(p.post_url)}" target="_blank" rel="noopener">View on LinkedIn →</a>
        <textarea class="note-input" placeholder="Note…" data-field="note">${escapeHtml(p.note)}</textarea>
        <input class="tag-input" placeholder="Tags, comma separated" data-field="tags" value="${escapeHtml(p.tags.join(", "))}" />
      </div>
      <div class="post-side">
        <div class="counts"><b>${p.likes}</b> likes</div>
        <div class="counts"><b>${p.comments}</b> comments</div>
        <div class="counts"><b>${p.reposts}</b> reposts</div>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll(".note-input, .tag-input").forEach((el) => {
    el.addEventListener(
      "change",
      debounce(async () => {
        const card = el.closest(".post-card");
        const id = card.dataset.id;
        const patch = {};
        if (el.dataset.field === "note") patch.note = el.value;
        if (el.dataset.field === "tags")
          patch.tags = el.value.split(",").map((t) => t.trim()).filter(Boolean);
        await api(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      }, 300)
    );
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function currentFilterParams() {
  const params = new URLSearchParams();
  const num = (id) => {
    const v = document.getElementById(id).value;
    if (v && Number(v) > 0) params.set(id.replace("f-", "").replace("-", "_"), v);
  };
  num("f-min-likes");
  num("f-min-comments");
  num("f-min-reposts");
  const since = document.getElementById("f-since").value;
  if (since) params.set("since", since);
  const competitor = document.getElementById("f-competitor").value;
  if (competitor) params.set("competitor_id", competitor);
  const list = document.getElementById("f-list").value;
  if (list) params.set("list_name", list);
  const media = document.getElementById("f-media").value;
  if (media) params.set("media_type", media);
  params.set("sort", document.getElementById("f-sort").value);
  return params;
}

async function loadFeed() {
  const params = currentFilterParams();
  const posts = await api(`/api/posts?${params.toString()}`);
  renderPosts(posts);
  document.getElementById("f-export").href = `/api/export.csv?${params.toString()}`;
}
document.getElementById("f-apply").addEventListener("click", loadFeed);

document.getElementById("f-export").addEventListener("click", async (e) => {
  e.preventDefault();
  const params = currentFilterParams();
  const res = await fetch(`/api/export.csv?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "competitor-posts.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// --- Competitors ---
async function loadCompetitors() {
  const [competitors, researchNotes] = await Promise.all([
    api("/api/competitors"),
    api("/api/research-notes"),
  ]);
  const latestResearchByCompetitor = Object.fromEntries(researchNotes.map((r) => [r.competitor_id, r]));

  const competitorSelect = document.getElementById("f-competitor");
  const listSelect = document.getElementById("f-list");
  competitorSelect.innerHTML = `<option value="">All</option>` + competitors
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  const lists = [...new Set(competitors.map((c) => c.list_name))];
  listSelect.innerHTML = `<option value="">All</option>` + lists
    .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`)
    .join("");

  const tbody = document.querySelector("#competitor-table tbody");
  tbody.innerHTML = competitors
    .map((c) => {
      const research = latestResearchByCompetitor[c.id];
      return `
    <tr data-id="${c.id}">
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.list_name)}</td>
      <td class="status-${c.status}">${c.status}</td>
      <td><a class="post-link" href="${escapeHtml(c.linkedin_url)}" target="_blank" rel="noopener">Profile ↗</a></td>
      <td>${c.website_url ? `<a class="post-link" href="${escapeHtml(c.website_url)}" target="_blank" rel="noopener">Site ↗</a>` : "—"}</td>
      <td style="max-width:260px;font-size:12.5px;color:var(--ink-muted);" title="${escapeHtml(research?.summary || "")}">
        ${research ? `${escapeHtml(research.summary).slice(0, 140)}${research.summary.length > 140 ? "…" : ""}` : "No research yet"}
      </td>
      <td>
        <button class="link toggle-status">${c.status === "active" ? "Archive" : "Reactivate"}</button>
        ${c.website_url ? `<button class="link research-now">Research now</button>` : ""}
      </td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".toggle-status").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.id;
      const current = row.querySelector("td.status-active, td.status-archived").classList.contains("status-active")
        ? "active"
        : "archived";
      await api(`/api/competitors/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: current === "active" ? "archived" : "active" }),
      });
      loadCompetitors();
    });
  });

  tbody.querySelectorAll(".research-now").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      btn.textContent = "Researching…";
      btn.disabled = true;
      try {
        await api(`/api/competitors/${row.dataset.id}/research`, { method: "POST" });
      } finally {
        loadCompetitors();
      }
    });
  });
}

document.getElementById("c-add").addEventListener("click", async () => {
  const name = document.getElementById("c-name").value.trim();
  const linkedin_url = document.getElementById("c-url").value.trim();
  const list_name = document.getElementById("c-list").value.trim() || "Default";
  const website_url = document.getElementById("c-website").value.trim();
  if (!name || !linkedin_url) return;
  await api("/api/competitors", { method: "POST", body: JSON.stringify({ name, linkedin_url, list_name, website_url }) });
  document.getElementById("c-name").value = "";
  document.getElementById("c-url").value = "";
  document.getElementById("c-list").value = "";
  document.getElementById("c-website").value = "";
  loadCompetitors();
});

document.getElementById("r-send-now").addEventListener("click", async () => {
  await api("/api/research/send-now", { method: "POST" });
  alert("Research run triggered for every competitor with a website URL set.");
  loadCompetitors();
});

// --- Digest ---
async function loadDigest() {
  const configs = await api("/api/digest-config");
  const config = configs[0];
  if (!config) return;
  document.getElementById("d-name").value = config.name;
  document.getElementById("d-list").value = config.list_name;
  document.getElementById("d-min-likes").value = config.min_likes;
  document.getElementById("d-top-n").value = config.top_n;
  document.getElementById("d-enabled").checked = config.enabled;
  document.getElementById("d-recipients").value = config.recipients.join(", ");
  document.getElementById("d-save").dataset.id = config.id;
}

document.getElementById("d-save").addEventListener("click", async (e) => {
  const body = {
    id: e.target.dataset.id || undefined,
    name: document.getElementById("d-name").value.trim() || "Weekly digest",
    list_name: document.getElementById("d-list").value.trim() || "all",
    min_likes: Number(document.getElementById("d-min-likes").value) || 0,
    top_n: Number(document.getElementById("d-top-n").value) || 10,
    enabled: document.getElementById("d-enabled").checked,
    recipients: document
      .getElementById("d-recipients")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const saved = await api("/api/digest-config", { method: "PUT", body: JSON.stringify(body) });
  e.target.dataset.id = saved.id;
});

document.getElementById("d-send-now").addEventListener("click", async () => {
  await api("/api/digest-config/send-now", { method: "POST" });
  alert("Digest send triggered — check the configured recipients' inboxes.");
});

async function init() {
  try {
    await loadCompetitors();
    await loadFeed();
    await loadDigest();
  } catch (err) {
    console.error(err);
  }
}
init();
