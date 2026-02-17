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
      dias_disponiveis TEXT NOT NULL, -- JSON string array (legado)
      toca_culto_jovens INTEGER NOT NULL DEFAULT 0,
      toca_primeiro_domingo INTEGER NOT NULL DEFAULT 0,
      dias_bloqueados TEXT NOT NULL DEFAULT '[]' -- JSON array de datas "YYYY-MM-DD"
    );

    CREATE TABLE IF NOT EXISTS IRMA_IGREJA_CONFIG (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      irma_id INTEGER NOT NULL,
      igreja_id INTEGER NOT NULL,
      dias_semana TEXT NOT NULL, -- JSON string array de dias para essa igreja
      toca_culto_jovens INTEGER NOT NULL DEFAULT 0,
      toca_primeiro_domingo INTEGER NOT NULL DEFAULT 0,
      UNIQUE (irma_id, igreja_id),
      FOREIGN KEY (irma_id) REFERENCES IRMAS(id) ON DELETE CASCADE,
      FOREIGN KEY (igreja_id) REFERENCES IGREJAS(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS idx_cfg_irma ON IRMA_IGREJA_CONFIG(irma_id);
    CREATE INDEX IF NOT EXISTS idx_cfg_igreja ON IRMA_IGREJA_CONFIG(igreja_id);
  `);

  const irmasColumns = db.prepare("PRAGMA table_info(IRMAS)").all();
  const hasCultoJovens = irmasColumns.some(col => col.name === "toca_culto_jovens");
  if (!hasCultoJovens) {
    db.exec("ALTER TABLE IRMAS ADD COLUMN toca_culto_jovens INTEGER NOT NULL DEFAULT 0");
  }

  // Migração de dados legados: replica disponibilidade global da irmã para cada igreja existente
  // quando ela ainda não possui configurações por igreja.
  const irmas = db.prepare("SELECT * FROM IRMAS").all();
  const igrejas = db.prepare("SELECT id FROM IGREJAS").all();
  const countCfgStmt = db.prepare("SELECT COUNT(*) as qtd FROM IRMA_IGREJA_CONFIG WHERE irma_id = ?");
  const insCfgStmt = db.prepare(`
    INSERT OR IGNORE INTO IRMA_IGREJA_CONFIG
      (irma_id, igreja_id, dias_semana, toca_culto_jovens, toca_primeiro_domingo)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const irma of irmas) {
      const qtd = countCfgStmt.get(irma.id)?.qtd || 0;
      if (qtd > 0) continue;

      const dias = irma.dias_disponiveis || "[]";
      for (const igreja of igrejas) {
        insCfgStmt.run(
          irma.id,
          igreja.id,
          dias,
          irma.toca_culto_jovens ? 1 : 0,
          irma.toca_primeiro_domingo ? 1 : 0
        );
      }
    }
  });
  tx();
}

module.exports = { db, init };
