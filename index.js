const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const app     = express();

app.use(cors());
app.use(express.json());

const EVO_URL      = "https://evo.commercialinteligence.com";
const EVO_APIKEY   = "EE1D3942631E-4639-BF69-84E6BCDDC294";
const EVO_INSTANCE = "Sistema de notificaçao";
const MEU_NUMERO   = "5561995809899";

const pendentes = new Map();

app.post("/notificar", async (req, res) => {
  const { jobId, titulo, score, propostas, budget, link, proposta } = req.body;
  if (!jobId || !titulo) return res.status(400).json({ error: "Dados incompletos" });

  pendentes.set(jobId, { titulo, link, proposta, score, ts: Date.now() });

  const agora = Date.now();
  pendentes.forEach((v, k) => { if (agora - v.ts > 3600000) pendentes.delete(k); });

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

app.post("/webhook/evolution", async (req, res) => {
  res.json({ ok: true });

  try {
    const body  = req.body;
    const texto =
      body?.data?.message?.conversation ||
      body?.data?.message?.extendedTextMessage?.text || "";

    if (!texto) return;

    const match = texto.trim().toUpperCase().match(/^ENVIAR\s+(.+)$/);
    if (!match) return;

    const jobId = match[1].trim();
    const job   = pendentes.get(jobId);

    if (!job) {
      await fetch(`${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "apikey": EVO_APIKEY },
        body:    JSON.stringify({
          number: MEU_NUMERO,
          text:   `⚠️ Projeto *${jobId}* não encontrado ou expirado.`
        })
      });
      return;
    }

    pendentes.set(jobId, { ...job, autoEnviar: true, ts: Date.now() });

    await fetch(`${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "apikey": EVO_APIKEY },
      body:    JSON.stringify({
        number: MEU_NUMERO,
        text:   `✅ Comando recebido! Enviando proposta para:\n*${job.titulo}*\n\n🚀 Certifique-se que o Workana está aberto no PC.`
      })
    });

  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

app.get("/pendente/:jobId", (req, res) => {
  const job = pendentes.get(req.params.jobId);
  if (job?.autoEnviar) {
    pendentes.delete(req.params.jobId);
    return res.json({ autoEnviar: true, link: job.link });
  }
  res.json({ autoEnviar: false });
});

app.get("/health", (_, res) => res.json({ status: "ok", pendentes: pendentes.size }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Workana Webhook rodando na porta ${PORT}`));
