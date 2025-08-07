# WebRTC
# Hướng Dẫn Dự Án WebRTC P2P Demo

Demo này minh họa cách xây dựng một cuộc gọi video P2P đơn giản sử dụng **WebRTC** và **Socket.io** làm signaling server.

## Thư mục dự án

```
webrtc-demo/
├── public/
│   ├── peer1.html       # Trang Caller (Peer1)
│   └── peer2.html       # Trang Callee (Peer2)
├── server.js            # Signaling server (Express + Socket.io)
└── package.json         # Thông tin dự án và dependencies
```

## Yêu cầu môi trường

* Node.js v12+ và npm
* Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge)
* Máy có camera + microphone (hoặc thiết bị thay thế)

## Cài đặt

1. **Khởi tạo package.json** (nếu chưa có):

   ```bash
   npm init -y
   ```
2. **Cài dependencies**:

   ```bash
   npm install express socket.io
   ```
3. (Tùy chọn) **Cài `nodemon`** để tự động reload:

   ```bash
   npm install --save-dev nodemon
   ```

   Trong `package.json` thêm:

   ```json
   "scripts": {
     "dev": "nodemon server.js"
   }
   ```

## Chạy Signaling Server

```bash
# Không dùng nodemon:
node server.js
# Hoặc dùng nodemon:
npm run dev
```

Server sẽ lắng nghe cổng **3000** và serve static files từ thư mục `public/`.

## Cách test cuộc gọi P2P

1. Mở **hai** cửa sổ/tabs trình duyệt:

   * Tab A: `http://localhost:3000/peer2.html` (Peer2 - Callee)
   * Tab B: `http://localhost:3000/peer1.html` (Peer1 - Caller)
2. Cho phép truy cập **Camera** và **Microphone**.
3. Trên **Peer1**, bấm nút **Call Peer**.
4. **Peer2** nhận thông báo và tự động trả `answer`.
5. Khi kết nối thành công, cả hai trang sẽ hiển thị video của nhau.

## Cơ chế hoạt động

1. **Signaling**: Socket.io trao đổi:

   * `join`: thông báo online
   * `offer` / `answer`: SDP negotiation
   * `ice-candidate`: ICE candidate exchange
2. **WebRTC**:

   * `getUserMedia()`: lấy stream local
   * `RTCPeerConnection`: createOffer / createAnswer
   * `onicecandidate` & `addIceCandidate`
   * `ontrack`: gán stream remote cho `<video>`
3. **P2P Media**: sau negotiation và ICE, kênh SRTP/DTLS truyền audio/video mã hóa trực tiếp giữa hai peer.

## Tuỳ chỉnh

* **STUN/TURN**: chỉnh `iceServers` trong HTML để thêm TURN server nếu cần.
* **UI & logic**: sửa `public/peer*.html` để thêm nút, status, data channel, v.v.

## Khắc phục sự cố

* **Không thấy peer**: đảm bảo cả hai client emit `join` sau khi connect.
* **Media error**: kiểm tra camera/microphone, browser permission.
* **ICE failure**: thêm TURN server hoặc kiểm tra mạng.

---

Mọi câu hỏi hoặc cần hỗ trợ thêm, vui lòng liên hệ!
