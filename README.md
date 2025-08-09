# Janus + Janode VideoRoom & Livestream WebRTC Demo

## 1. Giới thiệu

Dự án này minh họa cách sử dụng **Janus Gateway** và **Janode** để xây dựng 2 mô hình:

- **VideoRoom**: Nhiều peer tham gia cùng một phòng, publish và subscribe audio/video qua WebRTC.
- **Livestream (Streaming Plugin)**: Đẩy media từ **FFmpeg** hoặc thiết bị camera/micro lên Janus, viewer xem qua WebRTC.

---

## 2. Yêu cầu môi trường

- Node.js ≥ 18
- Janus Gateway chạy ở chế độ WebSocket (`ws://localhost:8188`)
- Trình duyệt hỗ trợ WebRTC (Chrome, Firefox, Edge)
- Máy tính có camera và microphone
- **FFmpeg** (để publish stream trong Livestream)

---

## 3. Cấu trúc thư mục

```
WEB-RTC/
├── server.mjs
├── public/
│   ├── peer1.html
│   ├── peer2.html
│   ├── client.js
│   └── livestream/
│       ├── publisher.html
│       └── viewer.html
└── janode/
```

---

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

---

## 5. Chạy Janus Gateway

```bash
docker run -d --name janus-gateway   -p 8088:8088 -p 8188:8188   -p 10000-10200:10000-10200/udp   meetecho/janus-gateway
```

Kiểm tra:

- REST: [http://localhost:8088/janus/info](http://localhost:8088/janus/info)
- WebSocket: `ws://localhost:8188`

> **Lưu ý**: Đảm bảo plugin `janus.plugin.videoroom` và `janus.plugin.streaming` đang được bật trong cấu hình Janus.

---

## 6. Chạy Signaling Server

```bash
node server.mjs
# hoặc
npm run dev
```

Mặc định server sẽ chạy ở cổng `4000` và serve các file tĩnh từ thư mục `public/`.

---

## 7. Test VideoRoom

1. Khởi động **Janus Gateway**.
2. Mở 2 tab trình duyệt:

   - Peer1: [http://localhost:4000/peer1.html](http://localhost:4000/peer1.html)
   - Peer2: [http://localhost:4000/peer2.html](http://localhost:4000/peer2.html)

3. Cho phép truy cập **camera** và **microphone**.
4. Cả hai join cùng một room (mặc định là `1234`).
5. **Quy trình kết nối VideoRoom**

      - **Peer1**:  
        1. Connect  
        2. Join  
        3. Publish  

      - **Peer2**:  
        1. Connect  
        2. Join  
        3. List (sẽ thấy ID của Peer1)  
        4. Chọn và Subscribe  

      > Nếu Peer2 publish, Peer1 sẽ subscribe lại để xem.

6. Sau khi publish, cả hai sẽ thấy video của nhau.

---

## 8. Test Livestream

1. Khởi động **Janus Gateway**.
2. Mở [http://localhost:4000/livestream/publisher.html](http://localhost:4000/livestream/publisher.html)
3. Kết nối WebSocket, tạo mountpoint (server trả về `video_port`, `audio_port`).
4. Copy lệnh FFmpeg hiển thị, dán vào terminal để bắt đầu đẩy stream.

Ví dụ lệnh FFmpeg từ webcam/micro trên Windows:

```bash
ffmpeg -f dshow -i video="HD Webcam":audio="Microphone Array (Intel® Smart Sound Technology for Digital Microphones)" -rtbufsize 256M -fflags nobuffer -use_wallclock_as_timestamps 1 -video_size 1280x720 -framerate 30 -pix_fmt yuv420p -map 0:v:0 -c:v libvpx -b:v 1M -deadline realtime -g 60 -an -payload_type 96 -f rtp rtp://127.0.0.1:{video_port} -map 0:a:0 -ar 48000 -ac 2 -c:a libopus -b:a 96k -application lowdelay -vn -payload_type 111 -f rtp rtp://127.0.0.1:{audio_port}
```

> **Note**: Thay `HD Webcam` và `Microphone Array...` bằng tên thiết bị thật của bạn.

5. Mở [http://localhost:4000/livestream/viewer.html](http://localhost:4000/livestream/viewer.html) để xem.

---

## 9. Sơ đồ kết nối

### VideoRoom
```
Peer1 (Browser)  <---SRTP/DTLS--->  Janus Gateway (VideoRoom plugin)  <---SRTP/DTLS--->  Peer2 (Browser)
       |                                        ^
       |  WebSocket (Signaling)                 |
       v                                        |
 Signaling Server (Node.js + Janode) <----------+
       |
       |  WebSocket API
       v
 Janus Gateway
```

### Livestream
```
FFmpeg (Webcam/Mic hoặc file video) 
      |
      | RTP (VP8/Opus) qua UDP
      v
Janus Gateway (Streaming plugin)
      ^
      | WebSocket API
      v
Signaling Server (Node.js + Janode)
      ^
      | WebSocket (mountpoint control)
      v
Publisher.html  --(Tạo mountpoint)--> Server
Viewer.html     <--(WebRTC subscribe)---- Server
```

---

## 10. Khắc phục sự cố

| Sự cố | Giải pháp |
|-------|-----------|
| Không thấy peer | Kiểm tra Room ID giống nhau |
| Không có audio/video | Kiểm tra quyền camera/mic |
| ICE failed | Thêm TURN server hoặc đổi mạng |
| Không kết nối được Janus | Kiểm tra Gateway và URL WebSocket |
| Livestream không nhận hình | Kiểm tra `video_port`, `audio_port` và lệnh FFmpeg |
