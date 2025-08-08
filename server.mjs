import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

import Connection from './janode/src/connection.js';
import VideoRoomPlugin from './janode/src/plugins/videoroom-plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ket joi janus
const connCfg = {
  is_admin: false,
  getAddress: () => [{ url: 'ws://localhost:8188/', apisecret: '' }],
  getMaxRetries: () => 3,
  getRetryTimeSeconds: () => 1,
  isAdmin: () => false,
  wsOptions: () => ({})
};
const connection = new Connection(connCfg);
await connection.open();
console.log('Connected to Janus');

try {
  const s = await connection.create();
  const h = await s.attach(VideoRoomPlugin);
  await h.message({ request: 'create', room: 1234, publishers: 8 });
  console.log('Room 1234 created');
  await h.detach(); await s.destroy();
} catch (e) {
  if (e._code === 427) console.log('Room 1234 already exists');
  else console.warn('Room create check:', e?.message);
}


const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, 'public')));

const peers = {}; 

wss.on('connection', async (ws) => {
  console.log(' WS client connected');
  const session = await connection.create();

  let name = null;
  let pubHandle = null;
  let subHandle = null;

  const bindPublisherEvents = () => {
    pubHandle.on('event', (plugindata, jsep) => {
      console.log('[pub_event]', plugindata?.data);
      if (jsep) ws.send(JSON.stringify({ type: 'jsep', jsep }));
      const pubs = plugindata?.data?.publishers;
      if (pubs) ws.send(JSON.stringify({ type: 'publishers', publishers: pubs }));
    });
    pubHandle.on('trickle', (c) => ws.send(JSON.stringify({ type: 'trickle', role: 'publisher', candidate: c })));
    pubHandle.on('webrtcup', () => {
      peers[name].isPublishing = true;
      console.log('webrtcup (publisher)', name);
      ws.send(JSON.stringify({ type: 'webrtcup', role: 'publisher' }));
    });
    pubHandle.on('hangup', () => ws.send(JSON.stringify({ type: 'hangup', role: 'publisher' })));
  };

  const bindSubscriberEvents = () => {
    subHandle.on('event', (pluginData, jsep) => {
      console.log('[sub_event]', pluginData?.data, 'jsep?', !!jsep);
      if (jsep) ws.send(JSON.stringify({ type: 'subscriber_jsep', jsep }));
    });
    subHandle.on('trickle', (c) => ws.send(JSON.stringify({ type: 'trickle', role: 'subscriber', candidate: c })));
    subHandle.on('webrtcup', () => {
      console.log('webrtcup (subscriber)', name);
      ws.send(JSON.stringify({ type:'webrtcup', role:'subscriber' }));
    });
  };

  const doSubscribe = async (feedId, attempt = 1) => {
    console.log(`🛰 subscribe request => feed: ${feedId} name: ${name} attempt: ${attempt}`);

    // Check publisher ready before subscribing
    const res = await pubHandle.message({ request: 'listparticipants', room: 1234 });
    const parts = res?.plugindata?.data?.participants || [];
    const pub = parts.find(p => p.id === feedId);

    if (!pub) {
      console.warn(` Feed ${feedId} not found, retry in 500ms...`);
      if (attempt < 5) setTimeout(() => doSubscribe(feedId, attempt + 1), 500);
      return;
    }

    if (pub.audio_codec === null && pub.video_codec === null) {
      console.warn(`Feed ${feedId} not ready yet (no codecs), retry in 500ms...`);
      if (attempt < 5) setTimeout(() => doSubscribe(feedId, attempt + 1), 500);
      return;
    }

    // Attach new handle
    subHandle = await session.attach(VideoRoomPlugin);
    peers[name].subHandle = subHandle;
    bindSubscriberEvents();

    console.log(`[join-subscriber] Sending join for feed ${feedId}`);
    const joinPayload = {
      request: 'join',
      room: 1234,
      ptype: 'subscriber',
      feed: feedId,
      offer_audio: true,
      offer_video: true
    };
    console.log('[JOIN payload]', joinPayload);

    const joinRes = await subHandle.message(joinPayload);
    console.log('[JOIN response]', joinRes.plugindata?.data || joinRes);

    if (!joinRes.jsep) {
      console.warn(`No OFFER after join for feed ${feedId}, retry in 500ms...`);
      if (attempt < 5) setTimeout(() => doSubscribe(feedId, attempt + 1), 500);
      return;
    }

    ws.send(JSON.stringify({ type: 'subscriber_jsep', jsep: joinRes.jsep }));
  };

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === 'join') {
        name = data.name;
        pubHandle = await session.attach(VideoRoomPlugin);
        peers[name] = { ws, session, pubHandle, subHandle: null, id: null, isPublishing: false };

        const res = await pubHandle.message({
          request: 'join',
          room: 1234,
          ptype: 'publisher',
          display: name
        });
        bindPublisherEvents();

        const joinedId = res?.plugindata?.data?.id;
        peers[name].id = joinedId;
        ws.send(JSON.stringify({ type: 'joined', id: joinedId }));
        return;
      }

      if (data.type === 'publish_offer') {
        if (!pubHandle) return;
        const res = await pubHandle.message({ request: 'publish', audio: true, video: true }, data.jsep);
        if (res.jsep) ws.send(JSON.stringify({ type: 'jsep', jsep: res.jsep }));
        return;
      }

      if (data.type === 'list') {
        const meId = peers[name]?.id;
        const res = await pubHandle.message({ request: 'listparticipants', room: 1234 });
        const parts = res?.plugindata?.data?.participants || [];
        const publishers = parts.filter(p => p.publisher && p.id !== meId)
          .map(p => ({ id: p.id, display: p.display || String(p.id) }));
        ws.send(JSON.stringify({ type: 'publishers', publishers }));
        console.log('list for', name, '=>', publishers);
        return;
      }

      if (data.type === 'subscribe') {
        if (subHandle) {
          try { await subHandle.detach(); } catch {}
          subHandle = null;
        }
        doSubscribe(data.feed);
        return;
      }

      if (data.type === 'start_subscribe') {
        if (!subHandle) return;
        console.log('start subscriber for', name);
        // Thay vì setLocalDescription, gọi message với jsep của client
        const res = await subHandle.message({ request: 'start', room: 1234 }, data.jsep);
        console.log('[subscriber start response]', res);
        return;
      }


      if (data.type === 'trickle') {
        const h = data.role === 'subscriber' ? subHandle : pubHandle;
        if (h) await h.trickle(data.candidate);
        return;
      }

      if (data.type === 'leave') {
        try { if (pubHandle) await pubHandle.detach(); } catch {}
        try { if (subHandle) await subHandle.detach(); } catch {}
        try { await session.destroy(); } catch {}
        if (name) delete peers[name];
        console.log(`👋 ${name} left`);
        return;
      }
    } catch (err) {
      console.error('❌ ws message handler error:', err);
      ws.send(JSON.stringify({ type: 'error', reason: err?.message || 'server error' }));
    }
  });

  ws.on('close', async () => {
    try { if (pubHandle) await pubHandle.detach(); } catch {}
    try { if (subHandle) await subHandle.detach(); } catch {}
    try { await session.destroy(); } catch {}
    if (name) delete peers[name];
    console.log('❌ WS disconnected');
  });
});

server.listen(4000, () => {
  console.log('🌐 http://localhost:4000');
});
