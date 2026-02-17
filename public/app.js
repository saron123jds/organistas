// public/app.js
const DIAS = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];

let igrejas = [];
let irmas = [];
let rodizios = [];

let previewAtual = null; // {data_inicio,data_fim,preview:[]}
let rodizioSelecionadoId = null;

function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function esc(str){
  return String(str ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[m]));
}

function toast(msg){
  alert(msg);
}

function buildDayChecks(containerId, prefix){
  const box = qs(containerId);
  box.innerHTML = "";
  DIAS.forEach(d => {
    const id = `${prefix}_${d}`;
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" id="${id}" value="${d}"> ${d}`;
    box.appendChild(lab);
  });
}

function getCheckedDays(prefix){
  return DIAS.filter(d => qs(`#${prefix}_${d}`).checked);
}

function setTabs(){
  qsa(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      qsa(".tab").forEach(b => b.classList.remove("active"));
      qsa(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      qs(`#tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

async function api(url, opts){
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro");
  return data;
}

/** Loaders **/
async function loadIgrejas(){
  igrejas = await api("/api/igrejas");
  renderIgrejas();
  renderPDFIgrejasChecks();
  updateDashboardStats();
}

async function loadIrmas(){
  irmas = await api("/api/irmas");
  renderIrmas();
  updateDashboardStats();
}

async function loadRodizios(){
  rodizios = await api("/api/rodizios");
  renderRodizios();
  updateDashboardStats();
}

function updateDashboardStats(){
  qs("#stat_igrejas").textContent = igrejas.length;
  qs("#stat_irmas").textContent = irmas.length;
  qs("#stat_rodizios").textContent = rodizios.length;
}

function togglePrimeiroDomingoField(){
  const tocaJovens = qs("#irma_culto_jovens").checked;
  const wrap = qs("#irma_primeiro_domingo_wrap");
  wrap.classList.toggle("hidden", !tocaJovens);
  if (!tocaJovens) qs("#irma_primeiro_domingo").checked = false;
}

/** Renderers **/
function renderIgrejas(){
  const box = qs("#lista_igrejas");
  box.innerHTML = "";

  if (igrejas.length === 0) {
    box.innerHTML = `<div class="muted">Nenhuma igreja cadastrada.</div>`;
    return;
  }

  igrejas.forEach(g => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="title">
        <div>
          <b>${esc(g.nome)}</b>
          <div class="muted small">Dias: ${g.dias_culto.join(", ")} • 1º Domingo: ${g.participa_primeiro_domingo ? "Sim" : "Não"} • Jovens: ${g.culto_jovens ? "Sim" : "Não"}</div>
        </div>
        <div class="row">
          <button class="btn danger" data-del="${g.id}">Excluir</button>
        </div>
      </div>
    `;
    div.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm("Excluir igreja?")) return;
      await api(`/api/igrejas/${g.id}`, { method:"DELETE" });
      await loadIgrejas();
    });
    box.appendChild(div);
  });
}

function renderIrmas(){
  const box = qs("#lista_irmas");
  box.innerHTML = "";

  if (irmas.length === 0) {
    box.innerHTML = `<div class="muted">Nenhuma irmã cadastrada.</div>`;
    return;
  }

  irmas.forEach(i => {
    const div = document.createElement("div");
    div.className = "item";
    const bloqueios = (i.dias_bloqueados || []).join(", ");
    div.innerHTML = `
      <div class="title">
        <div>
          <b>${esc(i.nome)}</b>
          <div class="muted small">Origem: ${esc(i.igreja_origem || "-")} • Dias: ${i.dias_disponiveis.join(", ")} • 1º Domingo: ${i.toca_primeiro_domingo ? "Sim" : "Não"}</div>
          <div class="muted small">Bloqueios: ${esc(bloqueios || "-")}</div>
          <div class="muted small">Culto de jovens: ${i.toca_culto_jovens ? "Sim" : "Não"}</div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${i.id}">Bloqueios</button>
          <button class="btn danger" data-del="${i.id}">Excluir</button>
        </div>
      </div>
    `;

    div.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm("Excluir irmã?")) return;
      await api(`/api/irmas/${i.id}`, { method:"DELETE" });
      await loadIrmas();
    });

    div.querySelector("[data-edit]").addEventListener("click", async () => {
      const atual = (i.dias_bloqueados || []).join(", ");
      const novo = prompt("Informe os dias bloqueados (YYYY-MM-DD) separados por vírgula:", atual);
      if (novo === null) return;
      const arr = novo.split(",").map(s => s.trim()).filter(Boolean);
      await api(`/api/irmas/${i.id}/bloqueios`, {
        method:"PUT",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ dias_bloqueados: arr })
      });
      await loadIrmas();
    });

    box.appendChild(div);
  });
}

function renderRodizios(){
  const box = qs("#lista_rodizios");
  box.innerHTML = "";

  if (rodizios.length === 0) {
    box.innerHTML = `<div class="muted">Nenhum rodízio salvo ainda.</div>`;
    return;
  }

  rodizios.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="title">
        <div>
          <b>Rodízio #${r.id}</b>
          <div class="muted small">Período: ${r.data_inicio.split("-").reverse().join("/")} à ${r.data_fim.split("-").reverse().join("/")}</div>
          <div class="muted small">Criado em: ${new Date(r.criado_em).toLocaleString()}</div>
        </div>
        <div class="row">
          <button class="btn" data-view="${r.id}">Visualizar</button>
          <button class="btn" data-reg="${r.id}">Regenerar</button>
          <button class="btn danger" data-del="${r.id}">Excluir</button>
        </div>
      </div>
    `;

    div.querySelector("[data-view]").addEventListener("click", async () => {
      await visualizarRodizio(r.id);
    });

    div.querySelector("[data-reg]").addEventListener("click", async () => {
      if (!confirm("Regenerar este rodízio? (As escalas antigas serão substituídas)")) return;
      await api(`/api/rodizios/${r.id}/regenerate`, { method:"POST" });
      await loadRodizios();
      if (rodizioSelecionadoId === r.id) await visualizarRodizio(r.id);
      toast("Rodízio regenerado!");
    });

    div.querySelector("[data-del]").addEventListener("click", async () => {
      if (!confirm("Excluir rodízio?")) return;
      await api(`/api/rodizios/${r.id}`, { method:"DELETE" });
      rodizioSelecionadoId = null;
      qs("#visual_box").innerHTML = "";
      qs("#btnSelecionarIgrejasPDF").disabled = true;
      await loadRodizios();
      toast("Rodízio excluído.");
    });

    box.appendChild(div);
  });
}

function renderPreview(preview){
  const box = qs("#preview_box");
  if (!preview || preview.length === 0) {
    box.innerHTML = `<div class="muted">Nenhuma escala gerada.</div>`;
    return;
  }

  const rows = preview.slice(0, 300).map(e => `
    <tr>
      <td>${e.data.split("-").reverse().join("/")}</td>
      <td>${e.dia_semana}${e.primeiro_domingo ? " (1º Dom.)" : ""}</td>
      <td>${e.igreja_nome}</td>
      <td>${e.irma_nome}</td>
    </tr>
  `).join("");

  box.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Dia</th>
          <th>Igreja</th>
          <th>Irmã</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="muted small">Mostrando até 300 linhas (a prévia completa é salva mesmo assim).</div>
  `;
}

function groupByMonthAndChurch(escalas){
  const map = new Map(); // month => church => items
  for (const e of escalas) {
    const month = e.data.slice(0,7);
    if (!map.has(month)) map.set(month, new Map());
    const m = map.get(month);
    if (!m.has(e.igreja_nome)) m.set(e.igreja_nome, []);
    m.get(e.igreja_nome).push(e);
  }
  return map;
}

async function visualizarRodizio(id){
  rodizioSelecionadoId = id;

  // muda para aba visualizar
  qsa(".tab").forEach(b => b.classList.remove("active"));
  qsa(".panel").forEach(p => p.classList.remove("active"));
  qs(`.tab[data-tab="visualizar"]`).classList.add("active");
  qs("#tab-visualizar").classList.add("active");

  const data = await api(`/api/rodizios/${id}`);
  const { rodizio, escalas } = data;

  qs("#btnSelecionarIgrejasPDF").disabled = false;

  const byMonth = groupByMonthAndChurch(escalas);
  const months = Array.from(byMonth.keys()).sort();

  let html = `
    <div class="item">
      <div><b>Rodízio #${rodizio.id}</b></div>
      <div class="muted small">Período: ${rodizio.data_inicio.split("-").reverse().join("/")} à ${rodizio.data_fim.split("-").reverse().join("/")}</div>
    </div>
  `;

  for (const m of months) {
    html += `<h3>${m}</h3>`;
    const churchMap = byMonth.get(m);
    const churches = Array.from(churchMap.keys()).sort();

    html += `<table class="table">
      <thead><tr><th>Igreja</th><th>Dia</th><th>Data</th><th>Irmã</th></tr></thead><tbody>`;

    for (const c of churches) {
      const items = churchMap.get(c).sort((a,b) => a.data.localeCompare(b.data));
      for (const it of items) {
        const dt = new Date(it.data + "T00:00:00");
        const dow = DIAS[dt.getDay()];
        html += `
          <tr>
            <td>${c}</td>
            <td>${dow}</td>
            <td>${it.data.split("-").reverse().join("/")}</td>
            <td>${it.irma_nome || "SEM ORGANISTA"}</td>
          </tr>
        `;
      }
    }

    html += `</tbody></table>`;
  }

  qs("#visual_box").innerHTML = html;
}

/** PDF modal **/
function renderPDFIgrejasChecks(){
  const box = qs("#pdf_igrejas_checks");
  box.innerHTML = "";
  igrejas.forEach(g => {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" value="${g.id}"> ${g.nome}`;
    box.appendChild(lab);
  });
}

function openPDFModal(){
  qs("#modal_pdf").classList.remove("hidden");
  qsa("#pdf_igrejas_checks input[type=checkbox]").forEach(c => c.checked = false);
}
function closePDFModal(){
  qs("#modal_pdf").classList.add("hidden");
}

/** Handlers **/
async function onSalvarIgreja(){
  const nome = qs("#igreja_nome").value.trim();
  const dias = getCheckedDays("igreja");
  const culto_jovens = qs("#igreja_jovens").checked;
  const participa_primeiro_domingo = qs("#igreja_primeiro_domingo").checked;

  if (!nome) return toast("Informe o nome da igreja.");
  if (dias.length === 0) return toast("Selecione ao menos 1 dia de culto.");

  await api("/api/igrejas", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ nome, dias_culto:dias, culto_jovens, participa_primeiro_domingo })
  });

  qs("#igreja_nome").value = "";
  qsa("#igreja_dias input").forEach(i => i.checked = false);
  qs("#igreja_jovens").checked = false;
  qs("#igreja_primeiro_domingo").checked = false;

  await loadIgrejas();
  toast("Igreja salva!");
}

async function onSalvarIrma(){
  const nome = qs("#irma_nome").value.trim();
  const igreja_origem = qs("#irma_igreja_origem").value.trim();
  const dias = getCheckedDays("irma");
  const toca_culto_jovens = qs("#irma_culto_jovens").checked;
  const toca_primeiro_domingo = toca_culto_jovens && qs("#irma_primeiro_domingo").checked;

  const bloqueiosTxt = qs("#irma_bloqueios").value.trim();
  const dias_bloqueados = bloqueiosTxt
    ? bloqueiosTxt.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  if (!nome) return toast("Informe o nome da irmã.");
  if (dias.length === 0) return toast("Selecione ao menos 1 dia disponível.");

  await api("/api/irmas", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ nome, igreja_origem, dias_disponiveis:dias, toca_culto_jovens, toca_primeiro_domingo, dias_bloqueados })
  });

  qs("#irma_nome").value = "";
  qs("#irma_igreja_origem").value = "";
  qsa("#irma_dias input").forEach(i => i.checked = false);
  qs("#irma_culto_jovens").checked = false;
  qs("#irma_primeiro_domingo").checked = false;
  togglePrimeiroDomingoField();
  qs("#irma_bloqueios").value = "";

  await loadIrmas();
  toast("Irmã salva!");
}

async function onGerar(){
  const data_inicio = qs("#rodizio_inicio").value;
  const data_fim = qs("#rodizio_fim").value;

  if (!data_inicio || !data_fim) return toast("Informe data início e fim.");

  const data = await api("/api/rodizios/generate", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ data_inicio, data_fim })
  });

  previewAtual = { data_inicio, data_fim, preview: data.preview };
  renderPreview(previewAtual.preview);
  qs("#btnSalvarRodizio").disabled = false;
  toast("Prévia gerada. Se estiver ok, clique em SALVAR.");
}

async function onSalvarRodizio(){
  if (!previewAtual) return;

  const payload = {
    data_inicio: previewAtual.data_inicio,
    data_fim: previewAtual.data_fim,
    escalas: previewAtual.preview.map(e => ({
      data: e.data,
      igreja_id: e.igreja_id,
      irma_id: e.irma_id
    }))
  };

  const saved = await api("/api/rodizios", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  previewAtual = null;
  qs("#preview_box").innerHTML = "";
  qs("#btnSalvarRodizio").disabled = true;

  await loadRodizios();
  toast(`Rodízio salvo! (#${saved.id})`);
}

function onClickGerarPDF(){
  if (!rodizioSelecionadoId) return toast("Selecione um rodízio primeiro.");
  openPDFModal();
}

function onPDFGerar(){
  if (!rodizioSelecionadoId) return;

  const cidade = encodeURIComponent(qs("#cidade_pdf").value.trim());
  const selected = qsa("#pdf_igrejas_checks input[type=checkbox]")
    .filter(c => c.checked)
    .map(c => c.value);

  const igreja_ids = selected.join(",");
  const url = `/api/rodizios/${rodizioSelecionadoId}/pdf?cidade=${cidade}&igreja_ids=${igreja_ids}`;

  window.open(url, "_blank");
  closePDFModal();
}

/** Init **/
window.addEventListener("DOMContentLoaded", async () => {
  setTabs();

  buildDayChecks("#igreja_dias", "igreja");
  buildDayChecks("#irma_dias", "irma");

  qs("#btnSalvarIgreja").addEventListener("click", onSalvarIgreja);
  qs("#btnSalvarIrma").addEventListener("click", onSalvarIrma);
  qs("#irma_culto_jovens").addEventListener("change", togglePrimeiroDomingoField);
  togglePrimeiroDomingoField();
  qs("#btnGerar").addEventListener("click", onGerar);
  qs("#btnSalvarRodizio").addEventListener("click", onSalvarRodizio);

  qs("#btnSelecionarIgrejasPDF").addEventListener("click", onClickGerarPDF);
  qs("#btnPDFCancelar").addEventListener("click", closePDFModal);
  qs("#btnPDFGerar").addEventListener("click", onPDFGerar);

  await loadIgrejas();
  await loadIrmas();
  await loadRodizios();
});
