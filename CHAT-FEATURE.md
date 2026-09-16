# Chat & Media Feature Specifications

## Scope & Current State
The Chat & Media feature provides real-time messaging, file/media attachment uploads, message deletion (for self and everyone), and clearing chat history across connected clients via Socket.IO and Redis Pub/Sub events with PostgreSQL persistence.

### Features Implemented
- Real-time message streaming via WebSockets (`Socket.IO`).
- Multi-instance event broadcasting via Redis Pub/Sub (`ioredis`).
- File & media upload support (Images, Videos, PDFs, Plain text) via Multer middleware into local `/uploads`.
- Soft-deletion for individual users (`deletedFor`) and global soft-deletion (`isDeleted`).
- REST endpoints for fetching historical messages, uploading media, and managing message deletions.

---

## Data Flow Architecture

```
Client App (Frontend)
    │
    ├── Realtime Socket Event ("event:message", "event:delete_message")
    │     ▼
    │   SocketService (src/services/socket.service.js)
    │     │
    │     ├──► MessageService (src/services/message.service.js)
    │     │      ▼
    │     │    MessageRepository (src/repositories/message.repository.js)
    │     │      ▼
    │     │    PostgreSQL Database (`messages` table via Prisma)
    │     │
    │     └──► Redis Publisher (pub.publish("MESSAGES"))
    │            ▼
    │          Redis Subscriber (sub.on("message"))
    │            ▼
    │          Socket.IO Broadcast (`io.emit("message")`)
    │
    └── HTTP Request (`POST /api/media/upload`, `GET /api/messages`)
          ▼
        API Router -> Controller -> Service -> Repository -> DB / Filesystem
```

---

## API Endpoints

| Method | Endpoint | Description | Middleware |
|---|---|---|---|
| `POST` | `/api/media/upload` | Upload media file (Max 50MB) | `uploadRateLimiter`, `uploadMiddleware` |
| `GET` | `/api/messages` | Retrieve non-deleted chat messages | None |
| `DELETE` | `/api/messages/:id/me` | Delete message for requesting user | None |
| `DELETE` | `/api/messages/:id/everyone` | Delete message for all participants | None |
| `DELETE` | `/api/messages/clear` | Clear all messages from chat | None |

---

## Future Improvements
1. **Tenant & Channel Scoping**: Restrict message delivery and socket rooms by `tenantId` and `channelId`.
2. **S3 / Cloud Storage**: Move file upload storage from local disk `/uploads` to AWS S3 or Cloudflare R2.
3. **End-to-End Encryption**: Encrypt payload before socket transmission for private messaging.
4. **Read Receipts & Reactions**: Add database structures for message delivery status and reaction counters.
