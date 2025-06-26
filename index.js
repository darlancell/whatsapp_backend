const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const port = 3000;
app.use(cors());
app.use(express.json({ limit: '100mb' }));


mongoose.connect(
  'mongodb+srv://filhodarlan909:<dd6dulg7>@whatsapp.1gyoobj.mongodb.net/whatsapp?retryWrites=true&w=majority&appName=whatsapp',
  { useNewUrlParser: true, useUnifiedTopology: true }
);

const Message = mongoose.model('Message', new mongoose.Schema({
  nome: String,
  telefone: String,
  destinatario: String,
  mensagem: String,
  isGroup: Boolean,
  data: { type: Date, default: Date.now },
  arquivo: {
    mimetype: String,
    filename: String,
    data: String,
  }
}));


const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

let qrCodeBase64 = null;
let isReady = false;

function padronizarTelefone(numero) {
  let apenasDigitos = numero.replace(/\D/g, '');
  if (!apenasDigitos.startsWith('55')) {
    apenasDigitos = '55' + apenasDigitos;
  }
  return apenasDigitos;
}

client.on('qr', async (qr) => {
  qrCodeBase64 = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('📲 Escaneie o QR Code com seu WhatsApp');
});

client.on('ready', () => {
  isReady = true;
  console.log('✅ WhatsApp conectado!');
});


client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp desconectado:', reason);
});


client.on('message', async (msg) => {
  try {
    const contato = await msg.getContact();
    const nome = contato.pushname || contato.name || 'Sem nome';
    const isGroup = msg.from.endsWith('@g.us');

    const telefone = isGroup ? msg.from : padronizarTelefone(contato.number);

    const data = {
      nome,
      telefone,
      destinatario: isGroup ? null : telefone,
      mensagem: msg.body,
      isGroup,
      data: new Date(),
    };

    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media) {
        data.arquivo = {
          mimetype: media.mimetype,
          filename: media.filename || 'arquivo',
          data: media.data,
        };
      }
    }

    await Message.create(data);
    console.log('💾 Mensagem salva no MongoDB');
  } catch (e) {
    console.error('❌ Erro ao salvar mensagem:', e);
  }
});


app.get('/qrcode', async (req, res) => {
  if (isReady) return res.json({ status: 'connected' });
  res.json({ status: 'waiting', qr: qrCodeBase64 });
});


app.get('/status', async (req, res) => {
  res.json({ status: isReady ? 'connected' : 'disconnected' });
});


app.get('/contacts', async (req, res) => {
  const mensagens = await Message.find().sort({ data: -1 });
  const contatosMap = new Map();

  mensagens.forEach(data => {
    const tel = data.telefone;
    if (!contatosMap.has(tel)) {
      contatosMap.set(tel, {
        telefone: tel,
        nome: data.nome || 'Sem nome',
        isGroup: data.isGroup || false,
      });
    }
  });

  res.json(Array.from(contatosMap.values()));
});


app.get('/chat/:telefone', async (req, res) => {
  const telefone = req.params.telefone;
  const mensagens = await Message.find({
    $or: [
      { telefone },
      { destinatario: telefone }
    ]
  }).sort({ data: 1 });

  res.json(mensagens.map(m => ({
    telefone: m.telefone,
    mensagem: m.mensagem,
    data: m.data,
    nome: m.nome,
    arquivo: m.arquivo || null,
  })));
});


app.post('/send-message', async (req, res) => {
  try {
    let { telefone, mensagem } = req.body;
    if (!telefone || !mensagem) return res.status(400).json({ error: 'Campos obrigatórios' });

    telefone = padronizarTelefone(telefone);
    const chatId = telefone.includes('@') ? telefone : `${telefone}@c.us`;

    const sent = await client.sendMessage(chatId, mensagem);

    await Message.create({
      nome: 'Eu',
      telefone: 'meu-numero-aqui',
      destinatario: telefone,
      mensagem,
      isGroup: chatId.endsWith('@g.us'),
      data: new Date(),
    });

    res.json({ success: true, id: sent.id._serialized });
  } catch (err) {
    console.error('❌ Erro ao enviar mensagem:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.post('/send-file', async (req, res) => {
  try {
    const { telefone, base64, filename, mimetype, legenda } = req.body;
    if (!telefone || !base64 || !filename) return res.status(400).json({ error: 'Dados incompletos' });

    const tel = padronizarTelefone(telefone);
    const chatId = tel.includes('@') ? tel : `${tel}@c.us`;

    const media = new MessageMedia(mimetype, base64, filename);
    await client.sendMessage(chatId, media, { caption: legenda });

    await Message.create({
      nome: 'Eu',
      telefone: 'meu-numero-aqui',
      destinatario: tel,
      mensagem: legenda || '',
      isGroup: chatId.endsWith('@g.us'),
      data: new Date(),
      arquivo: {
        mimetype,
        filename,
        data: base64,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao enviar arquivo:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

client.initialize();
app.listen(port, () => console.log(`🚀 API rodando em http://localhost:${port}`));
