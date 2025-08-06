const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  // Khi join, gửi danh sách peers khác
  socket.on('join', () => {
    const peers = Array.from(io.sockets.sockets.keys()).filter(id => id !== socket.id);
    socket.emit('peers', peers);
  });

  // Yêu cầu gọi từ Peer1
  socket.on('call-request', ({ to }) => {
    io.to(to).emit('incoming-call', { from: socket.id });
  });

  //  chấp nhận
  socket.on('call-accepted', ({ to }) => {
    io.to(to).emit('call-accepted', { from: socket.id });
  });

  //  từ chối
  socket.on('call-rejected', ({ to }) => {
    io.to(to).emit('call-rejected', { from: socket.id });
  });

  // Offer / Answer
  socket.on('offer', ({ offer, to }) => {
    io.to(to).emit('offer', { offer, from: socket.id });
  });
  socket.on('answer', ({ answer, to }) => {
    io.to(to).emit('answer', { answer, from: socket.id });
  });

  // ICE
  socket.on('ice-candidate', ({ candidate, to }) => {
    io.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

server.listen(3000, () => console.log(`Server running on http://localhost:3000`));
