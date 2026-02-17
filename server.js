// server.js
const express = require("express");
const path = require("path");
const PDFDocument = require("pdfkit");
const { db, init } = require("./database");

init();

const app = express();
const PORT = 9000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

/** Utils **/
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIA_IDX = new Map(DIAS.map((d, i) => [d, i]));

function dowName(dateObj) {
  return DIAS[dateObj.getDay()];
}
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(dateObj, n) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  return d;
}
function isFirstSunday(dateObj) {
  return dateObj.getDay() === 0 && dateObj.getDate() <= 7;
}
function monthKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function formatBR(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function formatBRFromISO(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** DB helpers **/
function getIgrejas() {
  return db.prepare("SELECT * FROM IGREJAS ORDER BY nome ASC").all().map(r => ({
    ...r,
    dias_culto: JSON.parse(r.dias_culto)
  }));
}
function getIrmas() {
  return db.prepare("SELECT * FROM IRMAS ORDER BY nome ASC").all().map(r => ({
    ...r,
    dias_disponiveis: JSON.parse(r.dias_disponiveis),
    dias_bloqueados: JSON.parse(r.dias_bloqueados),
    igrejas_preferencias: JSON.parse(r.igrejas_preferencias || "[]"),
    culto_jovens_igreja_ids: JSON.parse(r.culto_jovens_igreja_ids || "[]"),
    primeiro_domingo_igreja_ids: JSON.parse(r.primeiro_domingo_igreja_ids || "[]"),
    toca_culto_jovens: r.toca_culto_jovens ?? 0
  }));
}
function countEscalasByIrmaAllTime() {
  const rows = db.prepare(`
    SELECT irma_id as id, COUNT(*) as qtd
    FROM ESCALAS
    WHERE irma_id IS NOT NULL
    GROUP BY irma_id
  `).all();
  const map = new Map();
  rows.forEach(r => map.set(r.id, r.qtd));
  return map;
}
function lastScaleDateByIrmaBefore(dateISO) {
  const rows = db.prepare(`
    SELECT irma_id, MAX(data) as last_data
    FROM ESCALAS
    WHERE irma_id IS NOT NULL AND data < ?
    GROUP BY irma_id
  `).all(dateISO);
  const map = new Map();
  rows.forEach(r => map.set(r.irma_id, r.last_data));
  return map;
}
function lastWeekdayByPairBefore(dateISO) {
  // último registro por (irma, igreja) antes da data
  const rows = db.prepare(`
    SELECT e.irma_id, e.igreja_id, e.data
    FROM ESCALAS e
    INNER JOIN (
      SELECT irma_id, igreja_id, MAX(data) as max_data
      FROM ESCALAS
      WHERE irma_id IS NOT NULL AND data < ?
      GROUP BY irma_id, igreja_id
    ) t
    ON e.irma_id = t.irma_id AND e.igreja_id = t.igreja_id AND e.data = t.max_data
  `).all(dateISO);

  const map = new Map(); // key "irmaId|igrejaId" => weekdayName
  rows.forEach(r => {
    const d = parseISO(r.data);
    map.set(`${r.irma_id}|${r.igreja_id}`, dowName(d));
  });
  return map;
}

/** API - Igrejas **/
app.get("/api/igrejas", (req, res) => {
  res.json(getIgrejas());
});

app.post("/api/igrejas", (req, res) => {
  const { nome, dias_culto, culto_jovens, participa_primeiro_domingo } = req.body;

  if (!nome || !Array.isArray(dias_culto) || dias_culto.length === 0) {
    return res.status(400).json({ error: "Nome e dias de culto são obrigatórios." });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO IGREJAS (nome, dias_culto, culto_jovens, participa_primeiro_domingo)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(
      nome.trim(),
      JSON.stringify(dias_culto),
      culto_jovens ? 1 : 0,
      participa_primeiro_domingo ? 1 : 0
    );
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Não foi possível salvar igreja (nome duplicado?)." });
  }
});

app.delete("/api/igrejas/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM IGREJAS WHERE id = ?").run(id);
  res.json({ ok: true });
});

/** API - Irmãs **/
app.get("/api/irmas", (req, res) => {
  res.json(getIrmas());
});

app.post("/api/irmas", (req, res) => {
  const {
    nome,
    igreja_origem,
    dias_disponiveis,
    toca_culto_jovens,
    toca_primeiro_domingo,
    dias_bloqueados,
    igrejas_preferencias,
    culto_jovens_igreja_ids,
    primeiro_domingo_igreja_ids
  } = req.body;

  if (!nome || !Array.isArray(dias_disponiveis) || dias_disponiveis.length === 0) {
    return res.status(400).json({ error: "Nome e dias disponíveis são obrigatórios." });
  }

  const blocked = Array.isArray(dias_bloqueados) ? dias_bloqueados : [];
  const pref = Array.isArray(igrejas_preferencias) ? igrejas_preferencias : [];
  const jovensIgrejas = Array.isArray(culto_jovens_igreja_ids) ? culto_jovens_igreja_ids.map(Number).filter(Boolean) : [];
  const primeiroDomingoIgrejas = Array.isArray(primeiro_domingo_igreja_ids) ? primeiro_domingo_igreja_ids.map(Number).filter(Boolean) : [];

  try {
    const stmt = db.prepare(`
      INSERT INTO IRMAS (
        nome,
        igreja_origem,
        dias_disponiveis,
        igrejas_preferencias,
        toca_culto_jovens,
        culto_jovens_igreja_ids,
        toca_primeiro_domingo,
        primeiro_domingo_igreja_ids,
        dias_bloqueados
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      nome.trim(),
      igreja_origem ? igreja_origem.trim() : null,
      JSON.stringify(dias_disponiveis),
      JSON.stringify(pref),
      toca_culto_jovens ? 1 : 0,
      JSON.stringify(jovensIgrejas),
      toca_primeiro_domingo ? 1 : 0,
      JSON.stringify(primeiroDomingoIgrejas),
      JSON.stringify(blocked)
    );
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Não foi possível salvar irmã (nome duplicado?)." });
  }
});

app.put("/api/irmas/:id/bloqueios", (req, res) => {
  const id = Number(req.params.id);
  const { dias_bloqueados } = req.body;
  const blocked = Array.isArray(dias_bloqueados) ? dias_bloqueados : [];
  db.prepare("UPDATE IRMAS SET dias_bloqueados = ? WHERE id = ?").run(JSON.stringify(blocked), id);
  res.json({ ok: true });
});

app.delete("/api/irmas/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM IRMAS WHERE id = ?").run(id);
  res.json({ ok: true });
});

/** Geração (preview) **/
function generateSchedule(data_inicio, data_fim) {
  const igrejas = getIgrejas();
  const irmas = getIrmas();

  const allTimeCounts = countEscalasByIrmaAllTime();
  const lastDateMapDB = lastScaleDateByIrmaBefore(data_inicio);
  const lastWeekdayPairDB = lastWeekdayByPairBefore(data_inicio);

  // contadores "dentro do preview" para distribuição justa
  const periodCounts = new Map(); // irma_id => qtd

  // último dia tocado (considerando DB + preview)
  const lastPlayedDate = new Map(); // irma_id => YYYY-MM-DD
  for (const i of irmas) {
    if (lastDateMapDB.has(i.id)) lastPlayedDate.set(i.id, lastDateMapDB.get(i.id));
  }

  // última semana (dia) por par (irma,igreja) (considerando DB + preview)
  const lastWeekdayPair = new Map(lastWeekdayPairDB); // key => weekday

  const results = [];
  let start = parseISO(data_inicio);
  const end = parseISO(data_fim);

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const dateISO = toISODate(d);
    const dayName = dowName(d);
    const firstSunday = isFirstSunday(d);

    // Igrejas com culto nesse dia
    let cultos = igrejas.filter(g => g.dias_culto.includes(dayName));
    if (firstSunday) {
      cultos = cultos.filter(g => g.participa_primeiro_domingo === 1);
    }

    // Para cada igreja, escolhe 1 irmã
    for (const igreja of cultos) {
      const candidatos = irmas.filter(ir => {
        // regra 4: respeitar mapeamento de igreja+dias da irmã
        const pref = (ir.igrejas_preferencias || []).find(p => Number(p.igreja_id) === Number(igreja.id));
        if (!pref || !Array.isArray(pref.dias) || !pref.dias.includes(dayName)) return false;

        // bloqueios manuais
        if (ir.dias_bloqueados.includes(dateISO)) return false;

        // regra 2: culto de jovens / primeiro domingo
        if (igreja.culto_jovens === 1) {
          if (ir.toca_culto_jovens !== 1) return false;
          if ((ir.culto_jovens_igreja_ids || []).length > 0 && !(ir.culto_jovens_igreja_ids || []).includes(igreja.id)) return false;
        }
        if (firstSunday) {
          if (ir.toca_primeiro_domingo !== 1) return false;
          if ((ir.primeiro_domingo_igreja_ids || []).length > 0 && !(ir.primeiro_domingo_igreja_ids || []).includes(igreja.id)) return false;
        }

        // regra 1: proibido dias sequenciais (um dia antes)
        const last = lastPlayedDate.get(ir.id);
        if (last) {
          const lastD = parseISO(last);
          const diffDays = Math.round((parseISO(dateISO) - lastD) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) return false;
        }
        return true;
      });

      let chosen = null;

      if (candidatos.length > 0) {
        // Regra extra (Lucas): alternância por igreja quando houver opção
        const churchDays = igreja.dias_culto; // dias de culto da igreja

        const candidatesScored = candidatos.map(ir => {
          const pCount = periodCounts.get(ir.id) || 0;
          const allCount = allTimeCounts.get(ir.id) || 0;

          // score base: quem tocou menos tem prioridade
          // peso maior para o período atual, mas considera histórico
          const fairnessScore = pCount * 10 + allCount;

          // alternância: evita repetir o mesmo dia da semana no par (irma|igreja) quando possível alternar
          const key = `${ir.id}|${igreja.id}`;
          const lastW = lastWeekdayPair.get(key);
          const pref = (ir.igrejas_preferencias || []).find(p => Number(p.igreja_id) === Number(igreja.id));
          const diasDaIrmaNaIgreja = pref?.dias || [];
          const intersection = churchDays.filter(cd => diasDaIrmaNaIgreja.includes(cd));
          const canAlternate = intersection.length > 1;
          const alternationPenalty = (canAlternate && lastW === dayName) ? 5 : 0;

          // desempate leve
          const tie = Math.random();

          return { ir, fairnessScore, alternationPenalty, tie };
        });

        candidatesScored.sort((a, b) => {
          if (a.fairnessScore !== b.fairnessScore) return a.fairnessScore - b.fairnessScore;
          if (a.alternationPenalty !== b.alternationPenalty) return a.alternationPenalty - b.alternationPenalty;
          return a.tie - b.tie;
        });

        chosen = candidatesScored[0].ir;
      }

      results.push({
        data: dateISO,
        dia_semana: dayName,
        primeiro_domingo: firstSunday,
        igreja_id: igreja.id,
        igreja_nome: igreja.nome,
        irma_id: chosen ? chosen.id : null,
        irma_nome: chosen ? chosen.nome : "SEM ORGANISTA"
      });

      if (chosen) {
        // atualizar justiça e bloqueio de sequenciais
        periodCounts.set(chosen.id, (periodCounts.get(chosen.id) || 0) + 1);
        lastPlayedDate.set(chosen.id, dateISO);

        // atualizar alternância por igreja
        const key = `${chosen.id}|${igreja.id}`;
        lastWeekdayPair.set(key, dayName);
      }
    }
  }

  return results;
}

app.post("/api/rodizios/generate", (req, res) => {
  const { data_inicio, data_fim } = req.body;
  if (!data_inicio || !data_fim) return res.status(400).json({ error: "Informe data início e fim." });

  try {
    const preview = generateSchedule(data_inicio, data_fim);
    res.json({ ok: true, preview });
  } catch (e) {
    res.status(500).json({ error: "Erro ao gerar rodízio." });
  }
});

/** Salvar rodízio **/
app.post("/api/rodizios", (req, res) => {
  const { data_inicio, data_fim, escalas } = req.body;
  if (!data_inicio || !data_fim || !Array.isArray(escalas)) {
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const criado_em = new Date().toISOString();

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO RODIZIOS (data_inicio, data_fim, criado_em)
      VALUES (?, ?, ?)
    `).run(data_inicio, data_fim, criado_em);

    const rodizioId = info.lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO ESCALAS (rodizio_id, data, igreja_id, irma_id)
      VALUES (?, ?, ?, ?)
    `);

    for (const e of escalas) {
      ins.run(rodizioId, e.data, e.igreja_id, e.irma_id);
    }

    return rodizioId;
  });

  try {
    const rodizioId = tx();
    res.json({ ok: true, id: rodizioId });
  } catch (e) {
    res.status(500).json({ error: "Erro ao salvar rodízio." });
  }
});

/** Listar rodízios **/
app.get("/api/rodizios", (req, res) => {
  const rows = db.prepare("SELECT * FROM RODIZIOS ORDER BY id DESC").all();
  res.json(rows);
});

/** Detalhe rodízio **/
app.get("/api/rodizios/:id", (req, res) => {
  const id = Number(req.params.id);

  const rodizio = db.prepare("SELECT * FROM RODIZIOS WHERE id = ?").get(id);
  if (!rodizio) return res.status(404).json({ error: "Rodízio não encontrado." });

  const escalas = db.prepare(`
    SELECT
      e.id,
      e.data,
      e.igreja_id,
      g.nome as igreja_nome,
      e.irma_id,
      i.nome as irma_nome
    FROM ESCALAS e
    JOIN IGREJAS g ON g.id = e.igreja_id
    LEFT JOIN IRMAS i ON i.id = e.irma_id
    WHERE e.rodizio_id = ?
    ORDER BY e.data ASC, g.nome ASC
  `).all(id);

  res.json({ rodizio, escalas });
});

/** Excluir rodízio **/
app.delete("/api/rodizios/:id", (req, res) => {
  const id = Number(req.params.id);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ESCALAS WHERE rodizio_id = ?").run(id);
    db.prepare("DELETE FROM RODIZIOS WHERE id = ?").run(id);
  });

  tx();
  res.json({ ok: true });
});

/** Regenerar rodízio **/
app.post("/api/rodizios/:id/regenerate", (req, res) => {
  const id = Number(req.params.id);
  const rodizio = db.prepare("SELECT * FROM RODIZIOS WHERE id = ?").get(id);
  if (!rodizio) return res.status(404).json({ error: "Rodízio não encontrado." });

  try {
    const newPreview = generateSchedule(rodizio.data_inicio, rodizio.data_fim);

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM ESCALAS WHERE rodizio_id = ?").run(id);
      const ins = db.prepare(`
        INSERT INTO ESCALAS (rodizio_id, data, igreja_id, irma_id)
        VALUES (?, ?, ?, ?)
      `);
      for (const e of newPreview) {
        ins.run(id, e.data, e.igreja_id, e.irma_id);
      }
    });

    tx();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao regenerar rodízio." });
  }
});

/** PDF (layout igual ao modelo) **/
const MESES = [
  "JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO",
  "JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"
];

function groupForPdf(escalas, igrejasSelecionadas) {
  // Estrutura: monthKey -> churchId -> weekday -> [{day, name}]
  const byMonth = new Map();
  for (const e of escalas) {
    const d = parseISO(e.data);
    const mk = monthKey(d);
    if (!byMonth.has(mk)) byMonth.set(mk, new Map());
    const m = byMonth.get(mk);

    if (!igrejasSelecionadas.find(g => g.id === e.igreja_id)) continue;

    if (!m.has(e.igreja_id)) m.set(e.igreja_id, new Map());
    const cm = m.get(e.igreja_id);

    const wd = dowName(d);
    if (!cm.has(wd)) cm.set(wd, []);
    cm.get(wd).push({
      iso: e.data,
      day: d.getDate(),
      name: e.irma_nome || "SEM ORGANISTA"
    });
  }

  // ordenar listas por dia
  for (const [, m] of byMonth) {
    for (const [, cm] of m) {
      for (const [, list] of cm) {
        list.sort((a, b) => a.iso.localeCompare(b.iso));
      }
    }
  }

  return byMonth;
}

function buildPdfV2({ cidade, rodizio, escalas, igrejasSelecionadas }, res) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 22
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="rodizio_${rodizio.id}.pdf"`);
  doc.pipe(res);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const top = doc.page.margins.top;
  const bottom = doc.page.margins.bottom;
  const usableW = pageW - left - right;
  const usableH = pageH - top - bottom;

  // Cabeçalho (3 partes como modelo)
  doc.fontSize(9).text("CONGREGAÇÃO CRISTÃ NO BRASIL", left, top - 6, { width: usableW * 0.33, align: "left" });
  doc.fontSize(10).text((cidade || "CIDADE").toUpperCase(), left + usableW * 0.33, top - 6, { width: usableW * 0.34, align: "center" });
  doc.fontSize(9).text(`RODÍZIO DE ORGANISTAS - ${formatBRFromISO(rodizio.data_inicio)} à ${formatBRFromISO(rodizio.data_fim)}`, left + usableW * 0.67, top - 6, { width: usableW * 0.33, align: "right" });

  // Linha
  const headerY = top + 10;
  doc.moveTo(left, headerY).lineTo(left + usableW, headerY).stroke();

  const churches = igrejasSelecionadas.slice().sort((a,b)=>a.nome.localeCompare(b.nome));
  if (churches.length === 0) {
    doc.fontSize(12).text("Nenhuma igreja selecionada.", left, headerY + 18);
    doc.end();
    return;
  }

  const gap = 10;
  const colW = (usableW - gap * (churches.length - 1)) / churches.length;

  const dataMap = groupForPdf(escalas, churches);
  const months = Array.from(dataMap.keys()).sort();

  // Definições de tabela
  const churchTitleH = 18;
  const daysHeaderH = 16;
  const subHeaderH = 14;
  const rowH = 14;
  const monthLabelH = 16;
  const monthGap = 6;

  function drawCell(x, y, w, h, opts = {}) {
    if (opts.fill) {
      doc.save();
      doc.rect(x, y, w, h).fill(opts.fill);
      doc.restore();
      doc.rect(x, y, w, h).stroke();
    } else {
      doc.rect(x, y, w, h).stroke();
    }
  }

  function sortChurchDays(days) {
    return days.slice().sort((a,b)=> (DIA_IDX.get(a) ?? 99) - (DIA_IDX.get(b) ?? 99));
  }

  // Pré-calcular altura por mês: usa o máximo de linhas entre (igreja x subcolunas) para alinhar horizontalmente
  const monthHeights = new Map(); // mk => height
  for (const mk of months) {
    const m = dataMap.get(mk) || new Map();
    let maxRows = 1;
    for (const church of churches) {
      const churchDays = sortChurchDays(church.dias_culto);
      const cm = m.get(church.id) || new Map();
      for (const wd of churchDays) {
        const list = cm.get(wd) || [];
        if (list.length > maxRows) maxRows = list.length;
      }
    }
    const height = monthLabelH + daysHeaderH + subHeaderH + (rowH * maxRows) + monthGap;
    monthHeights.set(mk, height);
  }

  // Desenhar colunas (igrejas) lado a lado, meses alinhados por altura fixa por mês
  const startY = headerY + 10;
  // Títulos de igreja + dias (subcolunas) no topo (fixo)
  churches.forEach((church, idx) => {
    const x = left + idx * (colW + gap);
    const y = startY;

    // caixa igreja
    drawCell(x, y, colW, churchTitleH);
    doc.fontSize(9).text(church.nome.toUpperCase(), x, y + 5, { width: colW, align: "center" });
  });

  // Agora meses (blocos) com alinhamento horizontal
  let cursorY = startY + churchTitleH;
  for (const mk of months) {
    const [yy, mm] = mk.split("-");
    const monthName = MESES[Number(mm) - 1] || mk;

    const blockH = monthHeights.get(mk);

    // quebra de página se não couber
    if (cursorY + blockH + 28 > top + usableH) {
      doc.addPage();
      // redesenha cabeçalho por página
      const pageW2 = doc.page.width;
      const pageH2 = doc.page.height;
      const left2 = doc.page.margins.left;
      const right2 = doc.page.margins.right;
      const top2 = doc.page.margins.top;
      const usableW2 = pageW2 - left2 - right2;

      doc.fontSize(9).text("CONGREGAÇÃO CRISTÃ NO BRASIL", left2, top2 - 6, { width: usableW2 * 0.33, align: "left" });
      doc.fontSize(10).text((cidade || "CIDADE").toUpperCase(), left2 + usableW2 * 0.33, top2 - 6, { width: usableW2 * 0.34, align: "center" });
      doc.fontSize(9).text(`RODÍZIO DE ORGANISTAS - ${formatBRFromISO(rodizio.data_inicio)} à ${formatBRFromISO(rodizio.data_fim)}`, left2 + usableW2 * 0.67, top2 - 6, { width: usableW2 * 0.33, align: "right" });
      const headerY2 = top2 + 10;
      doc.moveTo(left2, headerY2).lineTo(left2 + usableW2, headerY2).stroke();

      // recalcula posições locais (mantém mesmas variáveis de largura)
      cursorY = headerY2 + 10;

      // redesenha títulos de igreja
      churches.forEach((church, idx) => {
        const x = left2 + idx * (colW + gap);
        const y = cursorY;
        drawCell(x, y, colW, churchTitleH);
        doc.fontSize(9).text(church.nome.toUpperCase(), x, y + 5, { width: colW, align: "center" });
      });
      cursorY += churchTitleH;
    }

    // Desenhar bloco do mês em todas as colunas
    churches.forEach((church, idx) => {
      const x0 = left + idx * (colW + gap);
      let y = cursorY;

      // label mês
      drawCell(x0, y, colW, monthLabelH, { fill: "#f0f0f0" });
      doc.fillColor("#000").fontSize(8).text(monthName, x0 + 6, y + 4, { width: colW - 12, align: "left" });
      doc.fillColor("#000");
      y += monthLabelH;

      // subcolunas por dia de culto
      const days = sortChurchDays(church.dias_culto);
      const subCols = Math.max(1, days.length);
      const subW = colW / subCols;

      // header dias
      for (let i = 0; i < subCols; i++) {
        const x = x0 + i * subW;
        drawCell(x, y, subW, daysHeaderH, { fill: "#ffffff" });
        const label = days[i] ? days[i] : "";
        doc.fontSize(8).text(label, x, y + 4, { width: subW, align: "center" });
      }
      y += daysHeaderH;

      // subheader Dia | Organista dentro de cada subcoluna
      for (let i = 0; i < subCols; i++) {
        const x = x0 + i * subW;
        // Dia
        const diaW = Math.max(24, subW * 0.25);
        const orgW = subW - diaW;

        drawCell(x, y, diaW, subHeaderH, { fill: "#d9d9d9" });
        drawCell(x + diaW, y, orgW, subHeaderH, { fill: "#d9d9d9" });

        doc.fontSize(7).fillColor("#000").text("Dia", x, y + 3, { width: diaW, align: "center" });
        doc.fontSize(7).fillColor("#000").text("Organista", x + diaW, y + 3, { width: orgW, align: "center" });
      }
      y += subHeaderH;

      // linhas (altura fixa pelo maxRows global do mês)
      const m = dataMap.get(mk) || new Map();
      const cm = m.get(church.id) || new Map();

      // calcula maxRows do mês global (igual em todas as colunas)
      let maxRows = 1;
      // (já estava em monthHeights; recalcula rápido)
      for (const c of churches) {
        const cDays = sortChurchDays(c.dias_culto);
        const ccm = m.get(c.id) || new Map();
        for (const wd of cDays) {
          const list = ccm.get(wd) || [];
          if (list.length > maxRows) maxRows = list.length;
        }
      }

      for (let r = 0; r < maxRows; r++) {
        for (let i = 0; i < subCols; i++) {
          const wd = days[i];
          const list = (wd && cm.get(wd)) ? cm.get(wd) : [];
          const item = list[r];

          const x = x0 + i * subW;
          const diaW = Math.max(24, subW * 0.25);
          const orgW = subW - diaW;

          // alterna fundo leve em linhas
          const fill = (r % 2 === 0) ? "#ffffff" : "#fafafa";
          drawCell(x, y, diaW, rowH, { fill });
          drawCell(x + diaW, y, orgW, rowH, { fill });

          doc.fontSize(7).fillColor("#000").text(item ? String(item.day) : "", x, y + 3, { width: diaW, align: "center" });
          doc.fontSize(7).fillColor("#000").text(item ? item.name : "", x + diaW + 2, y + 3, { width: orgW - 4, align: "left", ellipsis: true });
        }
        y += rowH;
      }

      // borda final do bloco (já desenhada pelos retângulos)
    });

    cursorY += blockH;
  }

  // Rodapé
  doc.fontSize(8).fillColor("#000").text("Sistema de Rodízio de Organistas", left, pageH - 26, {
    width: usableW,
    align: "center"
  });

  doc.end();
}

app.get("/api/rodizios/:id/pdf", (req, res) => {
  const id = Number(req.params.id);
  const cidade = (req.query.cidade || "").toString();

  const rodizio = db.prepare("SELECT * FROM RODIZIOS WHERE id = ?").get(id);
  if (!rodizio) return res.status(404).json({ error: "Rodízio não encontrado." });

  const igrejas = getIgrejas();
  let igrejaIds = (req.query.igreja_ids || "").toString().split(",").filter(Boolean).map(Number);
  if (igrejaIds.length === 0) igrejaIds = igrejas.map(g => g.id);

  const igrejasSelecionadas = igrejas.filter(g => igrejaIds.includes(g.id));

  const escalas = db.prepare(`
    SELECT
      e.data,
      e.igreja_id,
      g.nome as igreja_nome,
      e.irma_id,
      i.nome as irma_nome
    FROM ESCALAS e
    JOIN IGREJAS g ON g.id = e.igreja_id
    LEFT JOIN IRMAS i ON i.id = e.irma_id
    WHERE e.rodizio_id = ?
    ORDER BY e.data ASC, g.nome ASC
  `).all(id);

  buildPdfV2({ cidade, rodizio, escalas, igrejasSelecionadas }, res);
});

/** Start **/
app.listen(PORT, () => {
  console.log(`✅ Rodízio Organistas rodando em http://localhost:${PORT}`);
});
