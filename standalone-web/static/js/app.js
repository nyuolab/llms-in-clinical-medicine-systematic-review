
(function() {
  const tableEl = document.getElementById("table");
  const globalSearchEl = document.getElementById("globalSearch");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const resetViewBtn = document.getElementById("resetViewBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const randomInspectBtn = document.getElementById("randomInspectBtn");
  const groupBySelect = document.getElementById("groupBySelect");
  const columnToggles = document.getElementById("columnToggles");
  const densitySelect = document.getElementById("densitySelect");

  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

  let table;
  let payloadCache = null;
  let MODAL_EXCLUDED_FIELDS = new Set(["Include?"]);

  function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
  function textIncludes(h, n) { if (!n) return true; if (h == null) return false; return String(h).toLowerCase().includes(String(n).toLowerCase()); }
  function toCsv(v) { if (v==null) return ""; const s = typeof v==="object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
  function downloadFile(name, content, mime) { const b = new Blob([content], {type:mime}); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 100); }
  function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  function formatLink(field, value) {
    if (value == null || value === "") return "";
    const s = String(value).trim();
    if (field === "DOI")   return `<a href="https://doi.org/${encodeURIComponent(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`;
    if (field === "PMID")  return `<a href="https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(s)}/" target="_blank" rel="noopener">${escapeHtml(s)}</a>`;
    if (field === "PMCID") { const id = s.replace(/^PMC/i,""); return `<a href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${encodeURIComponent(id)}/" target="_blank" rel="noopener">${escapeHtml(s)}</a>`; }
    return null;
  }

  function prettyRenderValue(field, value) {
    const link = formatLink(field, value);
    if (link) return link;
    if (value == null) return "";
    if (typeof value === "object" && !Array.isArray(value)) {
      if (("answer" in value) || ("details" in value)) {
        const ans = value.answer;
        const ansLower = String(ans ?? "").toLowerCase();
        let tagClass = "tag"; if (ansLower === "yes") tagClass = "tag yes"; else if (ansLower === "no") tagClass = "tag no";
        return `<div class="kvblock"><div class="row"><span class="key">Answer</span><span class="val ${tagClass}">${escapeHtml(ans ?? "")}</span></div>${value.details ? `<div class="row"><span class="key">Details</span><span class="val">${escapeHtml(value.details)}</span></div>` : ""}</div>`;
      }
      const rows = Object.entries(value).map(([k,v]) => `<div class="row"><span class="key">${escapeHtml(k)}</span><span class="val">${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}</span></div>`).join("");
      return `<div class="kvblock">${rows}</div>`;
    }
    if (Array.isArray(value)) {
      const chips = value.filter(x => x != null && String(x).trim() !== "").map(x => `<span class="chip">${escapeHtml(x)}</span>`).join("");
      return `<div class="chips">${chips}</div>`;
    }
    return escapeHtml(value);
  }

  // --- Modal ---
  function renderModal(data) {
    modalTitle.textContent = data.Title ? String(data.Title) : "Study Details";
    modalBody.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "details-grid";

    const keys = Object.keys(data).filter(k => k !== "Title" && !MODAL_EXCLUDED_FIELDS.has(k));
    const preferred = (payloadCache && payloadCache.all_fields) ? payloadCache.all_fields : [];
    const order = keys.sort((a,b) => {
      const ia = preferred.indexOf(a), ib = preferred.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib;
    });

    order.forEach(k => {
      const label = document.createElement("div"); label.className = "label"; label.textContent = k;
      const val = document.createElement("div"); val.className = "value"; val.innerHTML = prettyRenderValue(k, data[k]);
      grid.appendChild(label); grid.appendChild(val);
    });

    modalBody.appendChild(grid);
    document.body.classList.add("modal-open");
    modalOverlay.classList.remove("hidden");
  }
  function closeModal(){ modalOverlay.classList.add("hidden"); document.body.classList.remove("modal-open"); }
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

  function initVanillaGrid(rows, columns, fields) {
    const stateKey = "vanilla-study-browser-v5";

    const fieldList = columns.map(c => ({ title: c.title || c.field, field: c.field, visible: c.field === "Title" ? true : !!c.visible }));

    const stateDefaults = {
      visibleCols: Object.fromEntries(fieldList.map(c => [c.field, c.visible])),
      sort: [], filters: {}, globalQ: "", groupBy: "", density: "compact"
    };

    let state = stateDefaults;
    try { const s = localStorage.getItem(stateKey); if (s) state = Object.assign({}, stateDefaults, JSON.parse(s)); } catch {}

    globalSearchEl.value = state.globalQ || "";
    groupBySelect.value = state.groupBy || "";
    if (densitySelect) densitySelect.value = state.density || "compact";
    applyDensity(state.density || "compact");

    function buildColumnToggles() {
      columnToggles.innerHTML = "";
      const list = payloadCache && payloadCache.hidden_everywhere ? fieldList.filter(c => !payloadCache.hidden_everywhere.includes(c.field)) : fieldList;
      list.forEach(col => {
        const id = "col_" + col.field.replace(/\W+/g, "_");
        const wrap = document.createElement("div");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = id;
        const checked = state.visibleCols[col.field] !== false || col.field === "Title"; cb.checked = checked;
        if (col.field === "Title") cb.disabled = true;
        cb.addEventListener("change", () => { state.visibleCols[col.field] = cb.checked; persist(); render(); });
        const label = document.createElement("label"); label.setAttribute("for", id); label.textContent = col.title;
        wrap.appendChild(cb); wrap.appendChild(label); columnToggles.appendChild(wrap);
      });
    }

    const tableNode = document.createElement("table"); tableNode.className = "vanilla-grid";
    const thead = document.createElement("thead"); const headerRow = document.createElement("tr"); const filterRow = document.createElement("tr"); const tbody = document.createElement("tbody");

    fieldList.forEach(col => {
      const th = document.createElement("th"); th.textContent = col.title; th.dataset.field = col.field; th.className = "sortable";
      th.addEventListener("click", (e) => {
        const field = col.field; const i = state.sort.findIndex(s => s.field === field);
        if (e.shiftKey) { if (i === -1) state.sort.push({field, dir:"asc"}); else { const curr = state.sort[i]; curr.dir = curr.dir === "asc" ? "desc" : (curr.dir === "desc" ? null : "asc"); if (!curr.dir) state.sort.splice(i,1);} }
        else { if (i === -1) state.sort = [{field, dir:"asc"}]; else { const curr = state.sort[i]; const next = curr.dir === "asc" ? "desc" : (curr.dir === "desc" ? null : "asc"); state.sort = next ? [{field, dir: next}] : []; } }
        persist(); render();
      });
      headerRow.appendChild(th);

      const fth = document.createElement("th");
      const input = document.createElement("input"); input.type = "text"; input.placeholder = "filter";
      input.value = state.filters[col.field] || "";
      const debounced = debounce(() => { state.filters[col.field] = input.value; persist(); render(); }, 300);
      input.addEventListener("input", debounced);
      fth.appendChild(input); filterRow.appendChild(fth);
    });

    thead.appendChild(headerRow); thead.appendChild(filterRow); tableNode.appendChild(thead); tableNode.appendChild(tbody);
    tableEl.innerHTML = ""; tableEl.appendChild(tableNode);

    function persist(){ try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch {} }

    const debouncedGlobal = debounce(() => { state.globalQ = globalSearchEl.value || ""; persist(); render(); }, 350);
    globalSearchEl.addEventListener("input", debouncedGlobal);

    clearFiltersBtn.addEventListener("click", () => {
      state.filters = {}; Array.from(filterRow.querySelectorAll("input")).forEach(inp => inp.value = "");
      state.globalQ = ""; globalSearchEl.value = ""; persist(); render();
    });

    resetViewBtn.addEventListener("click", () => { localStorage.removeItem(stateKey); localStorage.removeItem("tabulator-study-browser-v1"); window.location.reload(); });

    groupBySelect.addEventListener("change", () => { state.groupBy = groupBySelect.value || ""; persist(); render(); });

    if (densitySelect) densitySelect.addEventListener("change", () => { state.density = densitySelect.value; applyDensity(state.density); persist(); });

    exportCsvBtn.addEventListener("click", () => { const out = getCurrentDataForExport(); const header = out.fields.join(","); const lines = out.data.map(r => out.fields.map(f => toCsv(r[f])).join(",")); downloadFile("studies_filtered.csv", [header].concat(lines).join("\n"), "text/csv;charset=utf-8"); });
    exportJsonBtn.addEventListener("click", () => { const out = getCurrentDataForExport(); downloadFile("studies_filtered.json", JSON.stringify(out.data, null, 2), "application/json"); });

    function getFilteredSortedRows() {
      let arr = rows.slice();
      const active = Object.keys(state.filters).filter(f => (state.filters[f] || "").trim() !== "");
      if (active.length) arr = arr.filter(r => active.every(f => textIncludes(r[f], state.filters[f])));
      const q = (state.globalQ || "").trim().toLowerCase();
      if (q) arr = arr.filter(r => fieldList.some(c => { const v = r[c.field]; if (v == null) return false; const str = (typeof v === "object") ? JSON.stringify(v) : String(v); return str.toLowerCase().includes(q); }));
      if (state.sort.length) arr.sort((a,b) => { for (const s of state.sort) { const as = a[s.field]==null?"":String(a[s.field]); const bs = b[s.field]==null?"":String(b[s.field]); if (as<bs) return s.dir==="asc"?-1:1; if (as>bs) return s.dir==="asc"?1:-1; } return 0; });
      return arr;
    }

    function render() {
      Array.from(headerRow.children).forEach(th => { th.classList.remove("sort-asc","sort-desc"); const f = th.dataset.field; const s = state.sort.find(x => x.field === f); if (s) th.classList.add(s.dir==="asc"?"sort-asc":"sort-desc"); th.style.display = state.visibleCols[f]===false ? "none" : ""; });
      Array.from(filterRow.children).forEach((th, idx) => { const f = fieldList[idx].field; th.style.display = state.visibleCols[f]===false ? "none" : ""; });

      tbody.innerHTML = ""; const frag = document.createDocumentFragment(); const data = getFilteredSortedRows(); const visibleFields = fieldList.filter(c => state.visibleCols[c.field] !== false);
      function appendDataRow(r) {
        const tr = document.createElement("tr");
        visibleFields.forEach(col => {
          const td = document.createElement("td"); td.dataset.field = col.field;
          if (col.field === "Title") { td.innerHTML = `<a class="title-link">${escapeHtml(r[col.field] || "")}</a>`; td.querySelector(".title-link").addEventListener("click", (ev) => { ev.preventDefault(); renderModal(r); }); }
          else { td.innerHTML = prettyRenderValue(col.field, r[col.field]); }
          tr.appendChild(td);
        });
        frag.appendChild(tr);
      }
      if (!state.groupBy) data.forEach(appendDataRow);
      else {
        const gField = state.groupBy; const groups = {}; data.forEach(r => { const key = (r[gField]==null || r[gField]==="") ? "(blank)" : String(r[gField]); (groups[key]||(groups[key]=[])).push(r); });
        const keys = Object.keys(groups).sort(); const visibleFields2 = fieldList.filter(c => state.visibleCols[c.field] !== false);
        keys.forEach(k => { const trg = document.createElement("tr"); const tdg = document.createElement("td"); tdg.colSpan = visibleFields2.length; tdg.className = "group-cell"; tdg.textContent = `${gField}: ${k}  —  ${groups[k].length} study${groups[k].length===1?"":"ies"}`; trg.className="group-row"; trg.appendChild(tdg); frag.appendChild(trg); groups[k].forEach(appendDataRow); });
      }
      tbody.appendChild(frag);
    }

    function getCurrentDataForExport() { const data = getFilteredSortedRows(); const allFields = fieldList.map(c => c.field); return { data, fields: allFields }; }

    buildColumnToggles();
    render();
  
    if (randomInspectBtn) {
      randomInspectBtn.addEventListener("click", () => {
        try {
          const data = (typeof getFilteredSortedRows === "function") ? getFilteredSortedRows() : (rows || []);
          if (!data || !data.length) {
            alert("No studies available (check your filters).");
            return;
          }
          const pick = data[Math.floor(Math.random() * data.length)];
          renderModal(pick);
        } catch (e) {
          console.error("Random inspect failed:", e);
          alert("Unable to open a random study.");
        }
      });
    }
}

  function initTabulator(rows, columns, fields) {
    columns.forEach(c => {
      if (c.field === "Title") {
        c.frozen = true;
        c.formatter = function(cell){ const v = cell.getValue() || ""; return `<a class="title-link">${escapeHtml(v)}</a>`; };
        c.cellClick = function(e, cell) { renderModal(cell.getRow().getData()); };
      } else {
        c.formatter = function(cell){ return prettyRenderValue(cell.getField(), cell.getValue()); };
      }
      c.cssClass = (c.cssClass ? c.cssClass + " cell-wrap" : "cell-wrap");
      c.headerFilterLiveFilter = true;
      c.headerFilterPlaceholder = "filter";
      if (c.field === "DOI") { c.width = 140; c.minWidth = 120; }
    });

    table = new Tabulator(tableEl, {
      data: rows,
      columns: columns,
      layout: "fitDataFill",
      pagination: "local",
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, 100, 200],
      movableColumns: true,
      resizableRows: false,
      height: "calc(100vh - 190px)",
      placeholder: "No records match your filters.",
      clipboard: true,
      index: "index",
      initialSort: [{column: "Year", dir: "desc"}],
      persistence: { sort: true, filter: true, columns: true },
      persistenceID: "study-browser-v1",
    });

    columnToggles.innerHTML = "";
    let cols = table.getColumns().map(c => c.getDefinition());
    if (payloadCache && payloadCache.hidden_everywhere) cols = cols.filter(col => !payloadCache.hidden_everywhere.includes(col.field));
    cols.forEach(col => {
      const id = "col_" + col.field.replace(/\W+/g, "_");
      const wrap = document.createElement("div");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = id;
      const colObj = table.getColumn(col.field); const initiallyVisible = !colObj.isVisible ? true : colObj.isVisible();
      cb.checked = initiallyVisible || col.field === "Title"; if (col.field === "Title") cb.disabled = true;
      cb.addEventListener("change", () => { const obj = table.getColumn(col.field); if (!obj) return; if (cb.checked) obj.show(); else obj.hide(); });
      const label = document.createElement("label"); label.setAttribute("for", id); label.textContent = col.title;
      wrap.appendChild(cb); wrap.appendChild(label); columnToggles.appendChild(wrap);
    });

    const debouncedFilter = debounce(() => {
      const query = globalSearchEl.value || "";
      table.setFilter(function(data) {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        for (const key in data) {
          const v = data[key];
          if (v == null) continue;
          const str = (typeof v === "object") ? JSON.stringify(v) : String(v);
          if (str.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }, 350);
    globalSearchEl.addEventListener("input", debouncedFilter);

    clearFiltersBtn.addEventListener("click", () => { table.clearFilter(); table.clearHeaderFilter(); globalSearchEl.value = ""; });
    resetViewBtn.addEventListener("click", () => { localStorage.removeItem("tabulator-study-browser-v1"); window.location.reload(); });

    groupBySelect.addEventListener("change", () => { const field = groupBySelect.value; if (!field) { table.setGroupBy(false); return; } table.setGroupBy(field); });

    exportCsvBtn.addEventListener("click", () => { if (table.download) table.download("csv", "studies_filtered.csv"); });
    exportJsonBtn.addEventListener("click", () => { if (table.getData) downloadFile("studies_filtered.json", JSON.stringify(table.getData(), null, 2), "application/json"); });

    const densityKey = "density-preference"; const savedDensity = localStorage.getItem(densityKey) || "compact";
    if (densitySelect) densitySelect.value = savedDensity; applyDensity(savedDensity);
    if (densitySelect) densitySelect.addEventListener("change", () => { const m = densitySelect.value; localStorage.setItem(densityKey, m); applyDensity(m); });
  
    if (randomInspectBtn) {
      randomInspectBtn.addEventListener("click", () => {
        try {
          let data = [];
          if (table && typeof table.getData === "function") {
            data = table.getData() || [];
          }
          if (!data || !data.length) {
            alert("No studies available (check your filters).");
            return;
          }
          const pick = data[Math.floor(Math.random() * data.length)];
          renderModal(pick);
        } catch (e) {
          console.error("Random inspect failed:", e);
          alert("Unable to open a random study.");
        }
      });
    }
}

  function applyDensity(mode) {
    document.body.classList.remove("density-cozy", "density-compact");
    if (mode === "cozy") document.body.classList.add("density-cozy");
    else if (mode === "compact") document.body.classList.add("density-compact");
  }

  function init() {
    fetch("/data").then(r => r.json()).then(payload => {
      payloadCache = payload;
      if (payload.hidden_everywhere) payload.hidden_everywhere.forEach(f => MODAL_EXCLUDED_FIELDS.add(f));
      (payload.all_fields || []).forEach(f => { if (/\(Extracted\)/i.test(f)) MODAL_EXCLUDED_FIELDS.add(f); });

      const rows = payload.records || [];
      const columns = payload.columns || [];
      const fields = payload.all_fields || [];

      const groupCandidates = ["Year", "Specialty", "Task Types", "Evaluation Types", "Model Categories", "Region"];
      groupCandidates.forEach(f => {
        if (fields.includes(f)) {
          const opt = document.createElement("option"); opt.value = f; opt.textContent = f; groupBySelect.appendChild(opt);
        }
      });

      if (window.Tabulator) initTabulator(rows, columns, fields);
      else { console.warn("Tabulator not found; switching to vanilla grid."); initVanillaGrid(rows, columns, fields); }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
