const express = require("express");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "reijane2026";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

let sock = null;
let latestQR = null;
let statusConexao = "INICIANDO";

async function iniciarWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_reijane");

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQR = qr;
      statusConexao = "AGUARDANDO_QR";
    }
    if (connection === "open") {
      latestQR = null;
      statusConexao = "CONECTADO";
    }
    if (connection === "close") {
      statusConexao = "DESCONECTADO";
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(iniciarWhatsApp, 4000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!WEBHOOK_URL) return;
    for (const msg of messages) {
      if (!msg.key || msg.key.fromMe) continue;
      const texto = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ""
      ).trim();

      if (!texto) continue;

      try {
        await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: {
              key: msg.key,
              message: msg.message
            }
          })
        });
      } catch (e) {}
    }
  });
}

app.get("/qr", (req, res) => {
  if (statusConexao === "CONECTADO") {
    return res.send("<h2>WhatsApp Business da Reijane CONECTADO!</h2>");
  }
  if (!latestQR) {
    return res.send("<h2>Gerando QR Code... Atualize a pagina em 5 segundos.</h2>");
  }
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
  res.send(`
    <div style="font-family:sans-serif;text-align:center;margin-top:40px;">
      <h2>Conecte o WhatsApp Business da Reijane</h2>
      <p>Abra WhatsApp Business no iPhone &gt; Ajustes &gt; Aparelhos conectados &gt; Conectar aparelho</p>
      <img src="${qrImg}" alt="QR Code" />
    </div>
  `);
});

app.post("/enviar", async (req, res) => {
  const chave = req.headers["x-api-key"] || req.headers["apikey"];
  if (chave !== API_KEY) {
    return res.status(401).json({ erro: "Chave invalida" });
  }
  if (!sock || statusConexao !== "CONECTADO") {
    return res.status(503).json({ erro: "WhatsApp desconectado", status: statusConexao });
  }

  const { number, text } = req.body;
  const limpo = String(number || "").replace(/\D/g, "");
  if (limpo.length < 12 || !text) {
    return res.status(400).json({ erro: "Numero ou texto invalido" });
  }

  const jid = `${limpo}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.send(`Status: ${statusConexao}`);
});

app.listen(PORT, () => {
  iniciarWhatsApp();
});
