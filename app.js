/* PDF to Images — pages rendered by pdf.js (Mozilla, Apache-2.0) into canvases on this device. */
import * as pdfjsLib from "./lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

const { $, $$, h } = S3;
const saved = S3.store("pdf2img") || {};
const o = { fmt: saved.fmt || "png", dpi: saved.dpi || "150", quality: saved.quality || 90, transparent: !!saved.transparent };
const st = { js: null, name: "", base: "", n: 0, sizes: [], results: [], running: false, stop: false };
const MAX_PIXELS = 16777216, MAX_SIDE = 16384; // what every major browser can hold in one canvas

// ---------- pure helpers ----------
function parsePages(str, n) {
  const s = String(str || "").trim(), out = [];
  if (!s) return Array.from({ length: n }, (_, i) => i);
  for (let part of s.split(/[,;]+/)) {
    part = part.trim(); if (!part) continue;
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part); let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; } else if (/^\d+$/.test(part)) a = b = +part; else throw new Error("“" + part + "” isn't a page or range");
    if (a < 1 || b < 1 || a > n || b > n) throw new Error("Page " + (a > n || a < 1 ? a : b) + " doesn't exist (the file has " + n + ")");
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (!out.includes(p - 1)) out.push(p - 1);
  }
  if (!out.length) throw new Error("No pages selected");
  return out.sort((x, y) => x - y);
}
function fitScale(w, hh, scale) { // shrink only when the canvas would be too big for the browser
  const k = Math.min(1, MAX_SIDE / (w * scale), MAX_SIDE / (hh * scale), Math.sqrt(MAX_PIXELS / (w * scale * hh * scale)));
  return { scale: scale * k, capped: k < 1 };
}
const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }, EXT = { png: "png", jpeg: "jpg", webp: "webp" };
async function renderPage(js, i, opt) {
  const page = await js.getPage(i + 1), v1 = page.getViewport({ scale: 1 });
  const f = fitScale(v1.width, v1.height, opt.dpi / 72), vp = page.getViewport({ scale: f.scale });
  const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext("2d"), clear = opt.transparent && opt.fmt !== "jpeg";
  await page.render({ canvasContext: ctx, viewport: vp, background: clear ? "rgba(0,0,0,0)" : "#ffffff" }).promise;
  const blob = await new Promise(r => c.toBlob(r, MIME[opt.fmt], opt.quality / 100));
  page.cleanup();
  const out = { i, w: c.width, h: c.height, blob, capped: f.capped };
  c.width = c.height = 0; // free the pixels now; the blob keeps the image
  return out;
}
function openJs(bytes) { return pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise; }

// Tiny PDF writer for the demo and self-test: solid pages with a title (ASCII only).
function makePdf(pages) {
  const objs = [], kids = [];
  const font = 3 + pages.length * 2;
  pages.forEach((p, k) => {
    const id = 3 + k * 2, [r, g, b] = p.rgb, W = p.w, H = p.h;
    let s = "1 1 1 rg 0 0 " + W + " " + H + " re f " + r + " " + g + " " + b + " rg 0 " + (H * 0.72) + " " + W + " " + (H * 0.28) + " re f ";
    s += "0.86 0.88 0.91 rg"; for (let l = 0; l < 9; l++) s += " " + (W * 0.08) + " " + (H * 0.62 - l * H * 0.055) + " " + (W * (0.7 + ((l * 7) % 5) / 30)) + " " + (H * 0.018) + " re f";
    if (p.title) s += " BT /F1 " + Math.round(H * 0.07) + " Tf 1 1 1 rg " + (W * 0.08) + " " + (H * 0.8) + " Td (" + p.title.replace(/[()\\]/g, "") + ") Tj ET";
    kids.push(id + " 0 R");
    objs[id] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /Font << /F1 " + font + " 0 R >> >> /Contents " + (id + 1) + " 0 R >>";
    objs[id + 1] = "<< /Length " + s.length + " >>\nstream\n" + s + "\nendstream";
  });
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>";
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  let out = "%PDF-1.4\n"; const off = [];
  for (let i = 1; i < objs.length; i++) { off[i] = out.length; out += i + " 0 obj\n" + objs[i] + "\nendobj\n"; }
  const x = out.length;
  out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n" + off.slice(1).map(v => String(v).padStart(10, "0") + " 00000 n \n").join("");
  out += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + x + "\n%%EOF\n";
  return new TextEncoder().encode(out);
}

// ---------- UI ----------
function save() { S3.store("pdf2img", o); }
$$("#fmt button").forEach(b => {
  b.setAttribute("aria-pressed", String(b.dataset.v === o.fmt));
  b.addEventListener("click", () => { o.fmt = b.dataset.v; $$("#fmt button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); save(); syncOpts(); });
});
const probe = document.createElement("canvas"); probe.width = probe.height = 1;
if (!probe.toDataURL("image/webp").startsWith("data:image/webp")) { const w = $("#fmt button[data-v=webp]"); w.disabled = true; w.title = "This browser can't write WebP"; if (o.fmt === "webp") o.fmt = "png"; }
$("#dpi").value = o.dpi; $("#dpi").addEventListener("change", e => { o.dpi = e.target.value; save(); estimate(); });
$("#quality").value = o.quality; $("#qVal").textContent = o.quality;
$("#quality").addEventListener("input", e => { o.quality = +e.target.value; $("#qVal").textContent = o.quality; save(); });
$("#transparent").checked = o.transparent; $("#transparent").addEventListener("change", e => { o.transparent = e.target.checked; save(); });
$("#range").addEventListener("input", S3.debounce(estimate, 150));
function syncOpts() {
  $$("#fmt button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === o.fmt)));
  $("#qWrap").hidden = o.fmt === "png"; $("#transWrap").hidden = o.fmt === "jpeg";
}
function estimate() {
  const est = $("#est");
  if (!st.n) return;
  let pages;
  try { pages = parsePages($("#range").value, st.n); } catch (e) { est.className = "chip bad"; est.textContent = e.message; $("#go").disabled = true; return; }
  const s = st.sizes[pages[0]], k = fitScale(s[0], s[1], o.dpi / 72);
  est.className = "chip accent";
  est.textContent = pages.length + " page" + (pages.length > 1 ? "s" : "") + " · first is " + Math.floor(s[0] * k.scale) + "×" + Math.floor(s[1] * k.scale) + " px" + (k.capped ? " (capped)" : "");
  $("#go").disabled = st.running;
}

async function openFile(file) {
  try {
    const bytes = new Uint8Array(await S3.readFile(file));
    let js;
    try { js = await openJs(bytes); }
    catch (e) { throw new Error(e && e.name === "PasswordException" ? "This PDF needs a password to open. Remove the protection first." : "This file couldn't be read as a PDF."); }
    if (st.js) st.js.destroy();
    const sizes = [];
    for (let i = 1; i <= js.numPages; i++) { const v = (await js.getPage(i)).getViewport({ scale: 1 }); sizes.push([v.width, v.height]); }
    clearResults();
    Object.assign(st, { js, name: file.name, base: file.name.replace(/\.pdf$/i, "") || "document", n: js.numPages, sizes });
    $("#fname").textContent = file.name;
    $("#fmeta").textContent = st.n + " page" + (st.n > 1 ? "s" : "") + " · " + S3.fmtBytes(file.size);
    $("#drop").hidden = true; $("#work").hidden = false; $("#range").value = "";
    syncOpts(); estimate();
  } catch (e) { S3.toast(e.message, "error"); }
}
const fileInput = S3.drop($("#drop"), files => openFile(files[0]), { accept: ".pdf,application/pdf", multiple: false });
$("#change").addEventListener("click", () => { if (!st.running) fileInput.click(); });

function clearResults() { st.results.forEach(r => URL.revokeObjectURL(r.url)); st.results = []; $("#grid").innerHTML = ""; $("#results").hidden = true; }
function fname(r) { return st.base + "-p" + String(r.i + 1).padStart(Math.max(3, String(st.n).length), "0") + "." + r.ext; }
function addResult(r) {
  r.url = URL.createObjectURL(r.blob); st.results.push(r);
  $("#results").hidden = false;
  $("#rcount").textContent = st.results.length + " · " + S3.fmtBytes(st.results.reduce((s, x) => s + x.blob.size, 0));
  $("#grid").appendChild(h("figure", { "class": "pi-item" }, [
    h("div", { "class": "pi-img checker" }, [h("img", { src: r.url, alt: "Page " + (r.i + 1), loading: "lazy" })]),
    h("figcaption", null, [
      h("div", null, [h("b", { text: "Page " + (r.i + 1) }), h("span", { "class": "faint", text: r.w + "×" + r.h + " · " + S3.fmtBytes(r.blob.size) + (r.capped ? " · capped" : "") })]),
      h("button", { "class": "btn small", "aria-label": "Download page " + (r.i + 1), onclick: () => { S3.download(r.blob, fname(r)); S3.done(); } }, [h("span", { html: S3.icon("download") }), "Save"])
    ])
  ]));
}

$("#go").addEventListener("click", async () => {
  let pages;
  try { pages = parsePages($("#range").value, st.n); } catch (e) { S3.toast(e.message, "error"); return; }
  clearResults();
  st.running = true; st.stop = false;
  $("#go").disabled = true; $("#cancel").hidden = false; $("#progWrap").hidden = false;
  const prog = $("#prog"), opt = { dpi: +o.dpi, fmt: o.fmt, quality: o.quality, transparent: o.transparent };
  prog.max = pages.length; prog.value = 0;
  try {
    for (let k = 0; k < pages.length && !st.stop; k++) {
      $("#progText").textContent = "Rendering page " + (pages[k] + 1) + " (" + (k + 1) + " of " + pages.length + ")…";
      const r = await renderPage(st.js, pages[k], opt);
      if (!r.blob) throw new Error("The browser couldn't encode page " + (pages[k] + 1));
      r.ext = EXT[opt.fmt]; addResult(r); prog.value = k + 1;
    }
    $("#progText").textContent = st.stop ? "Stopped. " + st.results.length + " of " + pages.length + " pages done." : "Done: " + pages.length + " image" + (pages.length > 1 ? "s" : "") + ".";
    if (!st.stop) S3.done();
  } catch (e) { S3.toast("Rendering failed: " + (e && e.message || e), "error"); $("#progText").textContent = ""; }
  st.running = false; $("#cancel").hidden = true; estimate();
});
$("#cancel").addEventListener("click", () => { st.stop = true; });
$("#zip").addEventListener("click", async () => {
  if (!st.results.length) return;
  const files = await Promise.all(st.results.map(async r => ({ name: fname(r), data: new Uint8Array(await r.blob.arrayBuffer()) })));
  S3.download(S3.zip(files), st.base + "-images.zip"); S3.done();
});

// ---------- demo + self-test ----------
window.S3_DEMO = async () => {
  const pdf = makePdf([
    { w: 595, h: 842, rgb: [0.05, 0.62, 0.6], title: "Annual report" }, { w: 595, h: 842, rgb: [0.4, 0.31, 0.78], title: "Results" },
    { w: 842, h: 595, rgb: [0.89, 0.38, 0.29], title: "Charts" }, { w: 595, h: 842, rgb: [0.95, 0.66, 0.2], title: "Appendix" }
  ]);
  await openFile(new File([pdf], "Annual report.pdf", { type: "application/pdf" }));
  $("#dpi").value = "72"; o.dpi = "72";
  $("#go").click();
  await new Promise(r => setTimeout(r, 1500));
};
window.S3_SELFTEST = async () => {
  const js = await openJs(makePdf([{ w: 72, h: 144, rgb: [1, 0, 0] }, { w: 144, h: 72, rgb: [0, 1, 0] }, { w: 100, h: 100, rgb: [0, 0, 1] }]));
  const r = await renderPage(js, 1, { dpi: 150, fmt: "png", quality: 90, transparent: false });
  const img = await createImageBitmap(r.blob), c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0);
  const top = x.getImageData(150, 10, 1, 1).data; // inside the green band at the top of page 2
  const j = await renderPage(js, 2, { dpi: 72, fmt: "jpeg", quality: 80, transparent: true });
  let bad = false; try { parsePages("4", 3); } catch (e) { bad = true; }
  const capped = fitScale(5000, 5000, 600 / 72);
  return js.numPages === 3 && r.w === 300 && r.h === 150 && r.blob.type === "image/png" && top[1] > 200 && top[0] < 40 &&
    j.w === 100 && j.blob.type === "image/jpeg" && parsePages("3-1, 2", 3).join() === "0,1,2" && bad &&
    capped.capped && Math.floor(5000 * capped.scale) <= 4096;
};
