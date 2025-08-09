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
        console.log(` ${name} left`);
        return;
      }
    } catch (err) {
      console.error('ws message handler error:', err);
      ws.send(JSON.stringify({ type: 'error', reason: err?.message || 'server error' }));
    }
  });

  ws.on('close', async () => {
    try { if (pubHandle) await pubHandle.detach(); } catch {}
    try { if (subHandle) await subHandle.detach(); } catch {}
    try { await session.destroy(); } catch {}
    if (name) delete peers[name];
    console.log('WS disconnected');
  });
});

server.listen(4000, () => {
  console.log(' http://localhost:4000');
});

//livestream
import StreamingPlugin from './janode/src/plugins/streaming-plugin.js';

const JANUS_RTP_IP = '127.0.0.1';      // IP mà FFmpeg sẽ gửi RTP tới (nếu FFmpeg chạy cùng máy Docker Desktop thì để 127.0.0.1)
const RTP_VIDEO_PORT = 10000;          // Nằm trong range Docker đã publish: 10000–10200/udp
const RTP_AUDIO_PORT = 10002;

const lsServer = http.createServer();
const livestreamWSS = new WebSocketServer({ server: lsServer, path: '/livestream' });
lsServer.listen(4001, () => console.log('Livestream WS: ws://localhost:4001/livestream'));

livestreamWSS.on('connection', async (ws) => {
  console.log('Livestream WS client connected');
  let session = await connection.create();  // dùng connection Janus đã có ở đầu file
  let handle = null;

  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
  const attachSafe = async () => {
    if (!session) session = await connection.create();
    if (handle) { try { await handle.detach(); } catch {} }
    handle = await session.attach(StreamingPlugin);
    return handle;
  };

  ws.on('message', async (raw) => {
    let data; try { data = JSON.parse(raw); } catch { return; }

    // Publisher: tạo mountpoint cố định
    if (data.type === 'start_stream') {
      const id = Number(data.id) || 9999;
      const name = String(data.name || 'mylive');
      try {
        await attachSafe();

        try { await handle.message({ request: 'destroy', id }); } catch {}

        const createRes = await handle.message({
          request: 'create',
          type: 'rtp',
          id, name,
          description: 'Live via RTP (VP8/Opus)',
          is_private: false,
          audio: true, video: true,
          videoport: RTP_VIDEO_PORT,
          audioport: RTP_AUDIO_PORT,
          'rtcp-mux': true,
          rtp_profile: 'avpf',
          videopt: 96,  videortpmap: 'VP8/90000',
          audiopt: 111, audiortpmap: 'opus/48000/2'
        });
        console.log('[ls] createRes', createRes?.plugindata?.data || createRes);

        send({ type: 'mount_created', id, rtp: { ip: JANUS_RTP_IP, video_port: RTP_VIDEO_PORT, audio_port: RTP_AUDIO_PORT } });
      } catch (e) {
        console.error('start_stream error:', e);
        send({ type: 'error', reason: e?.message || String(e) });
      }
      return;
    }

    // Publisher: xoá mountpoint
    if (data.type === 'destroy_stream') {
      const id = Number(data.id) || 9999;
      try {
        if (!handle) await attachSafe();
        await handle.message({ request: 'destroy', id });
        send({ type: 'mount_destroyed', id });
      } catch (e) {
        console.error('destroy_stream error:', e);
        send({ type: 'error', reason: e?.message || String(e) });
      }
      return;
    }

    // Viewer: watch -> trả OFFER (JSEP)
    if (data.type === 'watch') {
      const id = Number(data.id) || 9999;
      try {
        await attachSafe();
        const res = await handle.message({ request: 'watch', id, audio: true, video: true });
        if (!res.jsep) throw new Error('No JSEP offer from Streaming plugin');
        send({ type: 'jsep', jsep: res.jsep });    // khớp viewer.html tranh gui sdp
      } catch (e) {
        console.error('watch error:', e);
        send({ type: 'error', reason: e?.message || String(e) });
      }
      return;
    }

    // Viewer: start (ANSWER)
    if (data.type === 'start' && data.jsep) {
      try {
        await handle.message({ request: 'start' }, data.jsep);
        console.log('[ls] webrtc start ok');
        send({ type: 'webrtcup' });
      } catch (e) {
        console.error('start error:', e);
        send({ type: 'error', reason: e?.message || String(e) });
      }
      return;
    }

    // ICE trickle (kể cả completed)
    if (data.type === 'trickle') {
      try {
        if (data.candidate && data.candidate.completed) {
          await handle.trickle({ completed: true });
        } else if (data.completed) {
          await handle.trickle({ completed: true });
        } else if (data.candidate) {
          await handle.trickle(data.candidate);
        }
      } catch {}
      return;
    }

    // Viewer: unwatch
    if (data.type === 'unwatch') {
      try { if (handle) await handle.message({ request: 'stop' }); } catch {}
      return;
    }
  });

  ws.on('close', async () => {
    try { if (handle) await handle.detach(); } catch {}
    try { if (session) await session.destroy(); } catch {}
    handle = null; session = null;
    console.log('Livestream WS disconnected');
  });
});
