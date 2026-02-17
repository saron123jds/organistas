// database.js
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "rodizio.sqlite");
const db = new Database(dbPath);

function init() {
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS IGREJAS (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      dias_culto TEXT NOT NULL, -- JSON string array ["Terça","Domingo"]
      culto_jovens INTEGER NOT NULL DEFAULT 0,
      participa_primeiro_domingo INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS IRMAS (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      igreja_origem TEXT,
      dias_disponiveis TEXT NOT NULL, -- JSON string array
      igrejas_preferencias TEXT NOT NULL DEFAULT '[]', -- JSON [{igreja_id, dias:[...]}]
      toca_culto_jovens INTEGER NOT NULL DEFAULT 0,
      culto_jovens_igreja_ids TEXT NOT NULL DEFAULT '[]', -- JSON [igreja_id]
      toca_primeiro_domingo INTEGER NOT NULL DEFAULT 0,
      primeiro_domingo_igreja_ids TEXT NOT NULL DEFAULT '[]', -- JSON [igreja_id]
      dias_bloqueados TEXT NOT NULL DEFAULT '[]' -- JSON array de datas "YYYY-MM-DD"
    );

    CREATE TABLE IF NOT EXISTS RODIZIOS (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_inicio TEXT NOT NULL, -- YYYY-MM-DD
      data_fim TEXT NOT NULL,    -- YYYY-MM-DD
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ESCALAS (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rodizio_id INTEGER NOT NULL,
      data TEXT NOT NULL, -- YYYY-MM-DD
      igreja_id INTEGER NOT NULL,
      irma_id INTEGER, -- pode ser NULL se não houver disponível
      FOREIGN KEY (rodizio_id) REFERENCES RODIZIOS(id) ON DELETE CASCADE,
      FOREIGN KEY (igreja_id) REFERENCES IGREJAS(id),
      FOREIGN KEY (irma_id) REFERENCES IRMAS(id)
    );

    CREATE INDEX IF NOT EXISTS idx_escalas_rodizio ON ESCALAS(rodizio_id);
    CREATE INDEX IF NOT EXISTS idx_escalas_data ON ESCALAS(data);
    CREATE INDEX IF NOT EXISTS idx_escalas_irma ON ESCALAS(irma_id);
    CREATE INDEX IF NOT EXISTS idx_escalas_igreja ON ESCALAS(igreja_id);
  `);

  const irmasColumns = db.prepare("PRAGMA table_info(IRMAS)").all();
  const hasCultoJovens = irmasColumns.some(col => col.name === "toca_culto_jovens");
  if (!hasCultoJovens) {
    db.exec("ALTER TABLE IRMAS ADD COLUMN toca_culto_jovens INTEGER NOT NULL DEFAULT 0");
  }

  const hasIgrejasPreferencias = irmasColumns.some(col => col.name === "igrejas_preferencias");
  if (!hasIgrejasPreferencias) {
    db.exec("ALTER TABLE IRMAS ADD COLUMN igrejas_preferencias TEXT NOT NULL DEFAULT '[]'");
  }

  const hasCultoJovensIgrejas = irmasColumns.some(col => col.name === "culto_jovens_igreja_ids");
  if (!hasCultoJovensIgrejas) {
    db.exec("ALTER TABLE IRMAS ADD COLUMN culto_jovens_igreja_ids TEXT NOT NULL DEFAULT '[]'");
  }

  const hasPrimeiroDomingoIgrejas = irmasColumns.some(col => col.name === "primeiro_domingo_igreja_ids");
  if (!hasPrimeiroDomingoIgrejas) {
    db.exec("ALTER TABLE IRMAS ADD COLUMN primeiro_domingo_igreja_ids TEXT NOT NULL DEFAULT '[]'");
  }
}

module.exports = { db, init };
