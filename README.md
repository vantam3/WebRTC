# Janus + Janode VideoRoom WebRTC Demo

## 1. Giới thiệu

Dự án này minh họa cách sử dụng **Janus Gateway** và **Janode** để tạo phòng VideoRoom WebRTC, nơi nhiều peer có thể tham gia và chia sẻ audio/video theo mô hình **publish–subscribe**.

## 2. Yêu cầu môi trường

- Node.js ≥ 18
- Janus Gateway chạy ở chế độ WebSocket (`ws://localhost:8188`)
- Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge)
- Máy tính có camera và microphone

## 3. Cấu trúc thư mục

```
WEB-RTC/
├── server.mjs
├── public/
│   ├── peer1.html
│   ├── peer2.html
│   └── client.js
└── janode/
```

## 4. Cài đặt

```bash
npm init -y
npm install
# Tùy chọn: cài nodemon
npm install --save-dev nodemon
```

Cập nhật `package.json`:

```json
"scripts": {
  "dev": "nodemon server.mjs"
}
```

## 5. Chạy Janus Gateway

```bash
docker run -d --name janus-gateway \
  -p 8088:8088 -p 8188:8188 \
  -p 10000-10200:10000-10200/udp \
  meetecho/janus-gateway
```

Kiểm tra:

- REST: [http://localhost:8088/janus/info](http://localhost:8088/janus/info)
- WebSocket: `ws://localhost:8188`

## 6. Chạy Signaling Server

```bash
node server.mjs
# hoặc
npm run dev
```

Mặc định server sẽ chạy ở cổng `3000` và serve các file tĩnh từ thư mục `public/`.

## 7. Test VideoRoom

1. Khởi động **Janus Gateway**.
2. Mở 2 tab trình duyệt:

   - Peer1: [http://localhost:3000/peer1.html](http://localhost:3000/peer1.html)
   - Peer2: [http://localhost:3000/peer2.html](http://localhost:3000/peer2.html)

3. Cho phép truy cập **camera** và **microphone**.
4. Cả hai join cùng một room (mặc định là `1234`).
5. Sau khi publish, cả hai sẽ thấy video của nhau.

## 8. Cơ chế hoạt động

- **Signaling** thông qua Janus/Janode: `join`, `publish`, `subscribe`, `trickle ICE`.
- **WebRTC** flow: `getUserMedia` → `RTCPeerConnection` → `ontrack`.
- Media truyền trực tiếp qua **SRTP/DTLS** sau khi **ICE** thành công.

## 9. Tuỳ chỉnh

- **Room ID**: thay đổi trong `server.mjs`.
- **STUN/TURN server**: chỉnh `iceServers` trong các file HTML.
- **Giao diện**: sửa trong `peer1.html`, `peer2.html`.

## 10. Khắc phục sự cố

| Sự cố | Giải pháp |
|-------|-----------|
| Không thấy peer | Kiểm tra Room ID giống nhau |
| Không có audio/video | Kiểm tra quyền camera/mic |
| ICE failed | Thêm TURN server hoặc đổi mạng |
| Không kết nối được Janus | Kiểm tra Gateway và URL WebSocket |

## 11. Sơ đồ kết nối
          Peer1 (Trình duyệt) 
             | 
             |   WebSocket (signaling)  
             |
Signaling Server (Node.js + Janode) 
             | 
             |   WebSocket (Janode API)  
             |
        Janus Gateway 
             |  
             |   Plugin API 
             |
             
      VideoRoom Plugin

Luồng media:
Peer1 ⇄ (SRTP/DTLS) ⇄ Janus VideoRoom ⇄ (SRTP/DTLS) ⇄ Peer2

Cơ chế:
- Peer1/Peer2 gửi và nhận tín hiệu (join, publish, subscribe, ICE) qua Node.js + Janode.
- Node.js + Janode gửi lệnh điều khiển tới Janus Gateway.
- Janus Gateway (VideoRoom plugin) thực hiện publish/subscribe và truyền media giữa các peer.
