const DB_NAME = "static-zip-tester-db";
const DB_VERSION = 1;
const STORE = "projects";
const META_KEY = "static-zip-tester-meta-v1";

const $ = (s) => document.querySelector(s);
const zipInput = $("#zipInput");
const dropZone = $("#dropZone");
const progressWrap = $("#progress");
const progressBar = $("#progressBar");
const progressText = $("#progressText");
const statusText = $("#statusText");
const projectList = $("#projectList");
const countBadge = $("#countBadge");
const runnerCard = $("#runnerCard");
const preview = $("#preview");
const passwordDialog = $("#passwordDialog");
const passwordInput = $("#passwordInput");
const passwordError = $("#passwordError");
const passwordForm = $("#passwordForm");

let currentFile = null;
let currentProject = null;
let currentRuntime = null;
let passwordResolver = null;

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function setProgress(label, percent) {
  progressWrap.classList.remove("hidden");
  statusText.textContent = label;
  const p = Math.max(0, Math.min(100, percent));
  progressText.textContent = `${Math.round(p)}%`;
  progressBar.style.width = `${p}%`;
}

function hideProgress() { progressWrap.classList.add("hidden"); }

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B","KB","MB","GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function tx(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

async function putProject(project) {
  await tx("readwrite", store => store.put(project));
}

async function getProjects() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.updatedAt - a.updatedAt));
    req.onerror = () => reject(req.error);
  });
}

async function deleteProject(id) {
  await tx("readwrite", store => store.delete(id));
}

function saveMeta(projects) {
  // Metadata only: never save ZIP contents or passwords in localStorage.
  localStorage.setItem(META_KEY, JSON.stringify(projects.map(p => ({
    id:p.id, name:p.name, size:p.size, updatedAt:p.updatedAt, entry:p.entry
  }))));
}

async function renderProjects() {
  const projects = await getProjects();
  countBadge.textContent = projects.length;
  saveMeta(projects);

  if (!projects.length) {
    projectList.innerHTML = '<div class="empty">Belum ada proyek.</div>';
    return;
  }

  projectList.innerHTML = projects.map(p => `
    <article class="project">
      <div class="project-main">
        <div class="project-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="project-meta">${formatBytes(p.size)} · ${new Date(p.updatedAt).toLocaleString("id-ID")} · entry: ${escapeHtml(p.entry)}</div>
      </div>
      <div class="project-actions">
        <button class="primary" data-open="${p.id}">Jalankan</button>
        <button class="ghost" data-delete="${p.id}">Hapus</button>
      </div>
    </article>`).join("");

  projectList.querySelectorAll("[data-open]").forEach(btn => {
    btn.onclick = async () => {
      const p = projects.find(x => x.id === btn.dataset.open);
      if (p) await runStoredProject(p);
    };
  });
  projectList.querySelectorAll("[data-delete]").forEach(btn => {
    btn.onclick = async () => {
      const p = projects.find(x => x.id === btn.dataset.delete);
      if (!p) return;
      if (!confirm(`Hapus proyek "${p.name}"?`)) return;
      await deleteProject(p.id);
      if (currentProject?.id === p.id) closeRunner();
      await renderProjects();
      toast("Proyek dihapus.");
    };
  });
}

function askPassword() {
  passwordInput.value = "";
  passwordError.textContent = "";
  passwordDialog.showModal();
  setTimeout(() => passwordInput.focus(), 50);
  return new Promise(resolve => passwordResolver = resolve);
}

passwordForm.addEventListener("submit", e => {
  if (e.submitter?.value === "cancel") {
    e.preventDefault();
    passwordDialog.close();
    passwordResolver?.(null);
    passwordResolver = null;
    return;
  }
  e.preventDefault();
  const pw = passwordInput.value;
  if (!pw) {
    passwordError.textContent = "Password tidak boleh kosong.";
    return;
  }
  passwordDialog.close();
  passwordResolver?.(pw);
  passwordResolver = null;
});

async function readZip(file, password = undefined) {
  const reader = new zip.ZipReader(new zip.BlobReader(file), password === undefined ? {} : { password });
  try {
    const entries = await reader.getEntries();
    const encrypted = entries.some(e => e.encrypted);
    return { reader, entries, encrypted };
  } catch (err) {
    await reader.close().catch(()=>{});
    throw err;
  }
}

async function extractZip(file) {
  let password;
  let reader, entries, encrypted;

  try {
    ({reader, entries, encrypted} = await readZip(file));
  } catch (err) {
    // Some encrypted archives expose the encryption state only when entry data is read.
    if (!String(err?.message || "").toLowerCase().includes("password")) throw err;
  }

  if (!reader) {
    password = await askPassword();
    if (password === null) throw new Error("Dibatalkan.");
    ({reader, entries, encrypted} = await readZip(file, password));
  }

  if (encrypted && password === undefined) {
    await reader.close();
    password = await askPassword();
    if (password === null) throw new Error("Dibatalkan.");
    ({reader, entries} = await readZip(file, password));
  }

  const files = new Map();
  const total = entries.filter(e => !e.directory).length || 1;
  let done = 0;

  try {
    for (const entry of entries) {
      if (entry.directory) continue;
      let blob;
      try {
        blob = await entry.getData(new zip.BlobWriter(), {
          password: password,
          onprogress: (index, max) => {
            const inner = max ? index / max : 0;
            setProgress(`Ekstrak: ${entry.filename}`, ((done + inner) / total) * 100);
          }
        });
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        if (msg.includes("password") || msg.includes("encrypted")) {
          await reader.close().catch(()=>{});
          password = await askPassword();
          if (password === null) throw new Error("Dibatalkan.");
          return extractZipWithPassword(file, password);
        }
        throw err;
      }
      const clean = normalizePath(entry.filename);
      if (clean) files.set(clean, blob);
      done++;
      setProgress(`Ekstrak: ${entry.filename}`, (done / total) * 100);
    }
  } finally {
    await reader.close().catch(()=>{});
  }
  return files;
}

async function extractZipWithPassword(file, password) {
  const {reader, entries} = await readZip(file, password);
  const files = new Map();
  const total = entries.filter(e => !e.directory).length || 1;
  let done = 0;
  try {
    for (const entry of entries) {
      if (entry.directory) continue;
      const blob = await entry.getData(new zip.BlobWriter(), {
        password,
        onprogress: (index,max) => setProgress(`Ekstrak: ${entry.filename}`, ((done + (max ? index/max : 0))/total)*100)
      });
      const clean = normalizePath(entry.filename);
      if (clean) files.set(clean, blob);
      done++;
    }
  } finally {
    await reader.close().catch(()=>{});
  }
  return files;
}

function normalizePath(path) {
  let p = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join("/");
}

function findEntry(files) {
  const candidates = [...files.keys()].filter(k => k.toLowerCase().endsWith("/index.html") || k.toLowerCase() === "index.html");
  if (!candidates.length) return null;
  // Prefer the shortest index.html path.
  return candidates.sort((a,b) => a.length - b.length)[0];
}

function dirname(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0,i);
}

function resolvePath(baseFile, ref) {
  try {
    const cleanRef = ref.split("#")[0].split("?")[0].trim();
    if (!cleanRef || /^(data:|blob:|https?:|mailto:|javascript:|#)/i.test(cleanRef)) return null;
    const base = new URL(cleanRef, "https://virtual.local/" + dirname(baseFile) + "/").pathname;
    return normalizePath(decodeURIComponent(base.replace(/^\/+/, "")));
  } catch { return null; }
}

function makeRuntimeUrlMap(files) {
  const urls = new Map();
  for (const [path, blob] of files) urls.set(path, URL.createObjectURL(blob));
  return urls;
}

function rewriteCss(css, filePath, urls) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full,q,ref) => {
    const target = resolvePath(filePath, ref);
    return target && urls.has(target) ? `url("${urls.get(target)}")` : full;
  });
}

function rewriteHtml(html, htmlPath, urls) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Remove active document-level behavior that could escape the preview through a base URL.
  doc.querySelectorAll("base").forEach(el => el.remove());

  doc.querySelectorAll("[src]").forEach(el => {
    const target = resolvePath(htmlPath, el.getAttribute("src"));
    if (target && urls.has(target)) el.setAttribute("src", urls.get(target));
  });

  doc.querySelectorAll("[href]").forEach(el => {
    const href = el.getAttribute("href");
    const target = resolvePath(htmlPath, href);
    if (target && urls.has(target)) el.setAttribute("href", urls.get(target));
  });

  doc.querySelectorAll("[srcset]").forEach(el => {
    const original = el.getAttribute("srcset");
    const rewritten = original.split(",").map(item => {
      const bits = item.trim().split(/\s+/);
      const target = resolvePath(htmlPath, bits[0]);
      if (target && urls.has(target)) bits[0] = urls.get(target);
      return bits.join(" ");
    }).join(", ");
    el.setAttribute("srcset", rewritten);
  });

  // Inline style="...url(...)..."
  doc.querySelectorAll("[style]").forEach(el => el.setAttribute("style", rewriteCss(el.getAttribute("style"), htmlPath, urls)));

  // Rewrite CSS text into Blob URLs.
  doc.querySelectorAll("style").forEach(style => {
    style.textContent = rewriteCss(style.textContent, htmlPath, urls);
  });

  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

async function buildRuntime(files) {
  const urls = makeRuntimeUrlMap(files);
  const entry = findEntry(files);
  if (!entry) {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    throw new Error("Tidak menemukan index.html di dalam ZIP.");
  }

  // CSS files need rewriting because url(...) is resolved relative to the CSS file.
  const rewrittenFiles = new Map(files);
  for (const [path, blob] of files) {
    if (/\.(css)$/i.test(path)) {
      const css = await blob.text();
      const out = rewriteCss(css, path, urls);
      rewrittenFiles.set(path, new Blob([out], {type:"text/css"}));
    }
  }

  // Recreate URLs for rewritten CSS.
  for (const [path, blob] of rewrittenFiles) {
    if (blob !== files.get(path)) {
      URL.revokeObjectURL(urls.get(path));
      urls.set(path, URL.createObjectURL(blob));
    }
  }

  const htmlBlob = files.get(entry);
  const html = await htmlBlob.text();
  const srcdoc = rewriteHtml(html, entry, urls);

  return { entry, srcdoc, urls };
}

async function runFiles(files, projectName, project = null) {
  setProgress("Menyiapkan runtime...", 95);
  const runtime = await buildRuntime(files);
  currentRuntime?.urls?.forEach(u => URL.revokeObjectURL(u));
  currentRuntime = runtime;
  currentProject = project || { name: projectName, entry: runtime.entry };

  $("#runnerTitle").textContent = projectName;
  $("#runnerInfo").textContent = `${runtime.entry} · ${files.size} file`;
  runnerCard.classList.remove("hidden");
  preview.srcdoc = runtime.srcdoc;
  runnerCard.scrollIntoView({behavior:"smooth", block:"start"});
  setProgress("Selesai", 100);
  setTimeout(hideProgress, 500);
}

async function handleZip(file) {
  if (!file || !file.name.toLowerCase().endsWith(".zip")) {
    toast("Pilih file ZIP.");
    return;
  }

  currentFile = file;
  setProgress("Membaca ZIP...", 3);

  try {
    const files = await extractZip(file);
    if (!files.size) throw new Error("ZIP tidak berisi file.");

    const entry = findEntry(files);
    if (!entry) throw new Error("ZIP harus memiliki index.html (di root atau folder utama).");

    const id = crypto.randomUUID();
    const project = {
      id,
      name: file.name.replace(/\.zip$/i, ""),
      originalName: file.name,
      size: file.size,
      updatedAt: Date.now(),
      entry,
      zipBlob: file
    };

    // Store the original ZIP. Password is deliberately never persisted.
    await putProject(project);
    await renderProjects();
    await runFiles(files, project.name, project);
    toast("Proyek berhasil disimpan dan dijalankan.");
  } catch (err) {
    console.error(err);
    hideProgress();
    toast(`Gagal: ${err.message || err}`);
  } finally {
    zipInput.value = "";
  }
}

async function runStoredProject(project) {
  setProgress("Membaca proyek tersimpan...", 10);
  try {
    const files = await extractZip(project.zipBlob);
    await runFiles(files, project.name, project);
  } catch (err) {
    hideProgress();
    toast(`Gagal menjalankan proyek: ${err.message || err}`);
  }
}

function closeRunner() {
  preview.srcdoc = "";
  runnerCard.classList.add("hidden");
  currentProject = null;
  currentRuntime?.urls?.forEach(u => URL.revokeObjectURL(u));
  currentRuntime = null;
}

function reloadRunner() {
  if (currentRuntime) preview.srcdoc = currentRuntime.srcdoc;
}

$("#pickBtn").onclick = () => zipInput.click();
zipInput.onchange = () => handleZip(zipInput.files[0]);

["dragenter","dragover"].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault(); dropZone.classList.add("drag");
}));
["dragleave","drop"].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault(); dropZone.classList.remove("drag");
}));
dropZone.addEventListener("drop", e => handleZip(e.dataTransfer.files[0]));

$("#closeBtn").onclick = closeRunner;
$("#reloadBtn").onclick = reloadRunner;

$("#openNewBtn").onclick = () => {
  if (!currentRuntime) return;
  const w = window.open();
  if (!w) { toast("Browser memblokir tab baru."); return; }
  w.document.open();
  w.document.write(currentRuntime.srcdoc);
  w.document.close();
};

$("#clearAllBtn").onclick = async () => {
  const projects = await getProjects();
  if (!projects.length) return toast("Tidak ada proyek tersimpan.");
  if (!confirm(`Hapus semua ${projects.length} proyek?`)) return;
  const db = await dbPromise;
  await new Promise((resolve,reject) => {
    const req = db.transaction(STORE,"readwrite").objectStore(STORE).clear();
    req.onsuccess = resolve; req.onerror = () => reject(req.error);
  });
  localStorage.removeItem(META_KEY);
  closeRunner();
  await renderProjects();
  toast("Semua proyek dihapus.");
};

window.addEventListener("beforeunload", () => {
  currentRuntime?.urls?.forEach(u => URL.revokeObjectURL(u));
});

renderProjects().catch(err => {
  console.error(err);
  toast("Gagal membuka penyimpanan lokal browser.");
});
