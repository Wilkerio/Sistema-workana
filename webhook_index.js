const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const app     = express();

app.use(cors());
app.use(express.json());

/* ─────────────────────────────────────────
   CONFIG — preencha após deployar
───────────────────────────────────────── */
const EVO_URL      = "https://evo.commercialinteligence.com";
const EVO_APIKEY   = "EE1D3942631E-4639-BF69-84E6BCDDC294";
const EVO_INSTANCE = "Sistema de notificaçao";
const MEU_NUMERO   = "5561995809899";

/* ─────────────────────────────────────────
   FILA DE PROJETOS PENDENTES
   Quando o usuário responde ENVIAR,
   o script do Workana busca aqui.
───────────────────────────────────────── */
const pendentes = new Map(); // jobId → { titulo, link, proposta }

/* ─────────────────────────────────────────
   POST /notificar
   Chamado pelo script do Workana quando
   detecta novo projeto.
   Body: { jobId, titulo, score, propostas, budget, link, proposta }
───────────────────────────────────────── */
app.post("/notificar", async (req, res) => {
  const { jobId, titulo, score, propostas, budget, link, proposta } = req.body;
  if (!jobId || !titulo) return res.status(400).json({ error: "Dados incompletos" });

  // Salva proposta na fila para uso posterior
  pendentes.set(jobId, { titulo, link, proposta, score });

  // Limpa entradas antigas (> 1 hora)
  const agora = Date.now();
  pendentes.forEach((v, k) => { if (agora - v.ts > 3600000) pendentes.delete(k); });

  // Emoji de score
  const emoji  = score >= 70 ? "🟢" : score >= 40 ? "🟡" : "🔴";
  const chance = score >= 70 ? "ALTA 🔥" : score >= 40 ? "MÉDIA ⚡" : "BAIXA ❄️";

  const msg =
    `${emoji} *Novo Projeto Workana!*\n\n` +
    `📌 *${titulo}*\n\n` +
    `💰 Orçamento: *${budget || "Não informado"}*\n` +
    `👥 Propostas: *${propostas || "0"}*\n` +
    `🎯 Score: *${score}%*\n` +
    `📊 Chance de fechar: *${chance}*\n\n` +
    `🔗 ${link}\n\n` +
    `──────────────────\n` +
    `👉 Responda *ENVIAR ${jobId}* para auto-enviar a proposta`;

  try {
    await fetch(`${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "apikey": EVO_APIKEY },
      body:    JSON.stringify({ number: MEU_NUMERO, text: msg })
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   POST /webhook/evolution
   Evolution chama este endpoint quando
   você responde no WhatsApp.
───────────────────────────────────────── */
app.post("/webhook/evolution", async (req, res) => {
  res.json({ ok: true }); // Responde rápido pro Evolution

  try {
    const body = req.body;

    // Pega o texto da mensagem recebida
    const texto =
      body?.data?.message?.conversation ||
      body?.data?.message?.extendedTextMessage?.text ||
      "";

    if (!texto) return;

    // Verifica se é comando ENVIAR
    const match = texto.trim().toUpperCase().match(/^ENVIAR\s+(.+)$/);
    if (!match) return;

    const jobId = match[1].trim();
    const job   = pendentes.get(jobId);

    if (!job) {
      // Job não encontrado ou expirado
      await fetch(`${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "apikey": EVO_APIKEY },
        body:    JSON.stringify({
          number: MEU_NUMERO,
          text:   `⚠️ Projeto *${jobId}* não encontrado ou expirado. Abra o Workana e use o botão 🚀 manualmente.`
        })
      });
      return;
    }

    // Marca como "pendente de auto-envio" — o script do Workana vai buscar
    pendentes.set(jobId, { ...job, autoEnviar: true, ts: Date.now() });

    await fetch(`${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "apikey": EVO_APIKEY },
      body:    JSON.stringify({
        number: MEU_NUMERO,
        text:   `✅ Comando recebido! Enviando proposta para:\n*${job.titulo}*\n\nCertifique-se que o Workana está aberto no PC. 🚀`
      })
    });

  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

/* ─────────────────────────────────────────
   GET /pendente/:jobId
   Script do Workana consulta este endpoint
   a cada 5s para ver se deve auto-enviar.
───────────────────────────────────────── */
app.get("/pendente/:jobId", (req, res) => {
  const job = pendentes.get(req.params.jobId);
  if (job?.autoEnviar) {
    // Limpa após entregar
    pendentes.delete(req.params.jobId);
    return res.json({ autoEnviar: true, link: job.link });
  }
  res.json({ autoEnviar: false });
});

/* ─────────────────────────────────────────
   GET /health — Railway usa para checar
───────────────────────────────────────── */
app.get("/health", (_, res) => res.json({ status: "ok", pendentes: pendentes.size }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Workana Webhook rodando na porta ${PORT}`));
