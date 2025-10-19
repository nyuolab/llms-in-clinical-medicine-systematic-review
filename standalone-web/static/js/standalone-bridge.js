(function(){
  async function getEmbeddedPayload() {
    const el = document.getElementById('__payload');
    if (!el) return null;
    try {
      const text = el.textContent || el.innerText || "";
      if (!text.trim()) return null;
      return JSON.parse(text);
    } catch (e) {
      console.warn("Failed to parse embedded payload:", e);
      return null;
    }
  }

  function parseYearFromDate(s) {
    if (s == null) return null;
    if (typeof s === "number" && s>=1800 && s<=2200) return s;
    const st = String(s);
    const fmts = [/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}$/, /^(\d{4})-(\d{2})-(\d{2})$/, /^(\d{4})$/];
    for (const re of fmts) {
      const m = st.match(re);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y>=1800 && y<=2200) return y;
      }
    }
    const m = st.match(/(19|20|21)\d{2}/);
    if (m) { const y = parseInt(m[0],10); if (!isNaN(y) && y>=1800 && y<=2200) return y; }
    return null;
  }

  function nanToNull(v) {
    if (typeof v === "number" && (!isFinite(v) || Number.isNaN(v))) return null;
    return v;
  }

  function toArray(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    return [v];
  }

  function processObj(obj) {
    const rec = {};
    const passthrough = ["index","DOI","Title","Abstract","NIHMS ID","PMID","PMCID","EID","Clinical Trial Numbers","Comments","LLM-tier","URL"];
    passthrough.forEach(k => { if (k in obj) rec[k] = nanToNull(obj[k]); });

    const y = parseYearFromDate(obj["Date"]) || parseYearFromDate(obj["temp_year"]);
    if (y) rec["Year"] = y;

    const ed = (obj["extracted_data"] || {});
    if (ed && typeof ed === "object") {
      const mapping = {
        "models_used": "Models Used",
        "specialty": "Specialty (Extracted)",
        "subspecialty": "Subspecialty (Extracted)",
        "types_of_human_evaluators": "Human Evaluators (Extracted)",
        "quantitative?": "Quantitative?",
        "sample_size": "Sample Size",
        "task_type": "Task Type (Extracted)",
        "geographical_region": "Region",
        "evaluation_type(s)": "Evaluation Types (Extracted)",
        "evaluation_metric(s)": "Evaluation Metrics (Extracted)",
        "datasets_used": "Datasets Used",
        "types_of_data_sources": "Data Source Types",
        "did_the_llm_outperform_the_human?": "LLM Outperformed Human?",
        "extremely_brief_summary_of_results": "Results Summary"
      };
      for (const [src, out] of Object.entries(mapping)) {
        if (src in ed) rec[out] = nanToNull(ed[src]);
      }
    }

    const pd = (obj["processed_data"] || {});
    if (pd && typeof pd === "object") {
      const pairs = [
        ["model_categories","Model Categories"],
        ["task_types","Task Types"],
        ["evaluation_types","Evaluation Types"],
        ["evaluation_metrics","Evaluation Metrics"],
        ["human_evaluators","Human Evaluators"],
        ["dataset_types","Dataset Types"],
      ];
      for (const [src, out] of pairs) {
        if (src in pd) rec[out] = pd[src];
      }
      const specs = pd["specialties"];
      if (Array.isArray(specs)) {
        const specSet = new Set(); const subSet = new Set();
        for (const item of specs) {
          if (Array.isArray(item)) {
            if (item.length>=1 && item[0]) specSet.add(String(item[0]));
            if (item.length>=2 && item[1]) subSet.add(String(item[1]));
          } else if (typeof item === "string") {
            specSet.add(item);
          }
        }
        if (specSet.size) rec["Specialty"] = Array.from(specSet).sort();
        if (subSet.size) rec["Subspecialty"] = Array.from(subSet).sort();
      }
    }

    return rec;
  }

  function guessType(values) {
    const nonNull = values.filter(v => v != null);
    if (!nonNull.length) return "string";
    if (nonNull.some(v => Array.isArray(v))) return "list";
    if (nonNull.some(v => typeof v === "object")) return "json";
    let numLike=0;
    for (const v of nonNull) {
      if (typeof v === "number" && isFinite(v)) numLike += 1;
      else {
        const vv = Number(String(v));
        if (!Number.isNaN(vv)) numLike += 0.2;
      }
    }
    return (numLike / nonNull.length > 0.8) ? "number" : "string";
  }

  function buildColumns(records, allFields, hidden) {
    const preferred = ["DOI","Title","Abstract","Specialty","Subspecialty","Sample Size","LLM Outperformed Human?","Model Categories","Evaluation Types","Year"];
    const cols = [];
    for (const f of allFields) {
      if (hidden.has(f)) continue;
      const values = records.map(r => r[f]);
      const kind = guessType(values);
      const def = { title: f, field: f, visible: preferred.includes(f) };
      def.headerFilter = (kind === "number") ? "number" : "input";
      cols.push(def);
    }
    return cols;
  }

  async function parseJSONL(text) {
    const out = [];
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (e) {
        try {
          out.push(JSON.parse(line.replaceAll("NaN", "null")));
        } catch (e2) {
          console.warn("Failed JSONL line:", e2, line.slice(0,120));
        }
      }
    }
    return out;
  }

  async function buildPayload(objs) {
    const records = objs.map(processObj);
    const freq = new Map();
    for (const r of records) {
      for (const k of Object.keys(r)) freq.set(k, (freq.get(k)||0)+1);
    }
    const allFields = Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
    const hidden = new Set(allFields.filter(f => f.toLowerCase() === "index" || f.includes("(Extracted)")));
    const columns = buildColumns(records, allFields, hidden);
    return {
      records,
      columns,
      all_fields: allFields.filter(f => !hidden.has(f)),
      hidden_everywhere: Array.from(hidden).sort()
    };
  }

  function installDataPickerOverlay(onChosen) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.7)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const box = document.createElement("div");
    box.style.background = "#0f1626";
    box.style.border = "1px solid #1b2435";
    box.style.borderRadius = "12px";
    box.style.padding = "24px";
    box.style.width = "min(720px, 95vw)";
    box.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5)";
    box.innerHTML = `
      <h2 style="margin:0 0 12px 0;color:#e9eef5;">Open data file</h2>
      <p style="margin:0 0 14px 0;color:#9aa4b2;">Choose <code>final_processed_studies_dated.jsonl</code> (or a compatible JSONL).</p>
      <input id="fileInputStandalone" type="file" accept=".jsonl,.json" style="margin:8px 0 16px 0;">
      <div style="display:flex;gap:8px;margin-top:4px;">
        <button id="useSampleBtn" style="padding:8px 12px;border-radius:8px;border:1px solid #1b2435;background:#0b0f17;color:#e9eef5;">Use embedded sample</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    return new Promise((resolve) => {
      const input = box.querySelector("#fileInputStandalone");
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const text = await file.text();
        const objs = await parseJSONL(text);
        const payload = await buildPayload(objs);
        overlay.remove();
        resolve(payload);
      });
      const sampleBtn = box.querySelector("#useSampleBtn");
      sampleBtn.addEventListener("click", async () => {
        const p = await getEmbeddedPayload();
        if (!p) { alert("No embedded sample found."); return; }
        overlay.remove();
        resolve(p);
      });
    });
  }

  const origFetch = window.fetch.bind(window);
  let cachedPayloadPromise = null;
  window.fetch = async function(resource, options) {
    const url = (typeof resource === "string") ? resource : (resource && resource.url);
    if (typeof url === "string" && (url === "/data" || url.endsWith("/data"))) {
      if (!cachedPayloadPromise) {
        cachedPayloadPromise = (async () => {
          const embedded = await getEmbeddedPayload();
          if (embedded) return embedded;
          return await installDataPickerOverlay();
        })();
      }
      const payload = await cachedPayloadPromise;
      const blob = new Blob([JSON.stringify(payload)], {type:"application/json"});
      return new Response(blob, {status:200, headers:{"Content-Type":"application/json"}});
    }
    return origFetch(resource, options);
  };
})();
