const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const admin = require('firebase-admin');
const path = require('path');

// 🔑 Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, 'firebase-key.json')))
});
const db = admin.firestore();

// 🚀 Express
const app = express();
const port = 3000;
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// 🔗 WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

// 🔥 Evento QR Code
client.on('qr', (qr) => {
  console.log('📲 Escaneie o QR Code:');
  qrcode.generate(qr, { small: true });
});

// 🔥 Evento pronto
client.on('ready', () => {
  console.log('✅ WhatsApp conectado!');
});

// 🔥 Evento desconectado
client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp desconectado:', reason);
});

// 📞 Função para padronizar telefone
function padronizarTelefone(numero) {
  let apenasDigitos = numero.replace(/\D/g, '');
  if (!apenasDigitos.startsWith('55')) {
    apenasDigitos = '55' + apenasDigitos;
  }
  return apenasDigitos;
}

// ⚙️ Seu número pessoal (ajuste para seu número)
const meuTelefone = '5588997245006';

// 🔥 Escutar mensagens recebidas
client.on('message', async (msg) => {
  try {
    const contato = await msg.getContact();
    const nome = contato.pushname || contato.name || 'Sem nome';
    const isGroup = msg.from.endsWith('@g.us');

    let telefone = isGroup ? msg.from : padronizarTelefone(contato.number);

    const data = {
      nome,
      telefone,
      destinatario: isGroup ? null : meuTelefone,
      mensagem: msg.body,
      isGroup,
      data: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Se for mídia
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

    await db.collection('mensagens').add(data);
    console.log('💾 Mensagem salva:', data);
  } catch (error) {
    console.error('❌ Erro ao salvar mensagem recebida:', error);
  }
});

// 🔗 Listar contatos
app.get('/contacts', async (req, res) => {
  try {
    const mensagensSnapshot = await db.collection('mensagens')
      .orderBy('data', 'desc')
      .get();

    const contatosMap = new Map();

    mensagensSnapshot.forEach(doc => {
      const data = doc.data();
      const tel = data.telefone;
      if (tel !== meuTelefone) {
        if (!contatosMap.has(tel)) {
          contatosMap.set(tel, {
            telefone: tel,
            nome: data.nome || 'Sem nome',
            isGroup: data.isGroup || false,
          });
        }
      }
    });

    res.json(Array.from(contatosMap.values()));
  } catch (error) {
    console.error('❌ Erro ao buscar contatos:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// 🔗 Buscar chat por telefone
app.get('/chat/:telefone', async (req, res) => {
  try {
    const contatoTelefone = req.params.telefone;

    const mensagensSnapshot = await db.collection('mensagens')
      .orderBy('data', 'asc')
      .get();

    const mensagens = [];

    mensagensSnapshot.forEach(doc => {
      const data = doc.data();
      const telefoneMsg = data.telefone;
      const destinatarioMsg = data.destinatario || null;
      if (!data.data) return;

      if (
        telefoneMsg === contatoTelefone ||
        (telefoneMsg === meuTelefone && destinatarioMsg === contatoTelefone)
      ) {
        mensagens.push({
          telefone: telefoneMsg,
          mensagem: data.mensagem,
          data: data.data.toDate(),
          nome: data.nome || '',
          arquivo: data.arquivo || null,
        });
      }
    });

    res.json(mensagens);
  } catch (error) {
    console.error('❌ Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// 🔗 Enviar mensagem de texto
app.post('/send-message', async (req, res) => {
  try {
    let { telefone, mensagem } = req.body;
    if (!telefone || !mensagem) {
      return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' });
    }

    telefone = padronizarTelefone(telefone);
    const chatId = telefone.includes('@') ? telefone : `${telefone}@c.us`;

    const sentMessage = await client.sendMessage(chatId, mensagem);

    await db.collection('mensagens').add({
      nome: 'Eu',
      telefone: meuTelefone,
      destinatario: telefone,
      mensagem,
      isGroup: chatId.endsWith('@g.us'),
      data: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    return res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// 🔗 Enviar arquivo (mídia)
app.post('/send-file', async (req, res) => {
  try {
    const { telefone, base64, filename, mimetype, legenda } = req.body;
    if (!telefone || !base64 || !filename) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    const tel = padronizarTelefone(telefone);
    const chatId = tel.includes('@') ? tel : `${tel}@c.us`;

    const media = new MessageMedia(mimetype, base64, filename);
    await client.sendMessage(chatId, media, { caption: legenda });

    await db.collection('mensagens').add({
      nome: 'Eu',
      telefone: meuTelefone,
      destinatario: tel,
      mensagem: legenda || '',
      isGroup: chatId.endsWith('@g.us'),
      data: admin.firestore.FieldValue.serverTimestamp(),
      arquivo: {
        mimetype,
        filename,
        data: base64,
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao enviar arquivo:', error);
    return res.status(500).json({ error: 'Erro ao enviar arquivo' });
  }
});

// 🚀 Inicializa o WhatsApp
client.initialize();

// 🚀 Inicializa o servidor
app.listen(port, () => {
  console.log(`🚀 API rodando em http://localhost:${port}`);
});
