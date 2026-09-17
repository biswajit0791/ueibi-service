# Chat & Media Feature Specifications

## Scope & Current State
Authenticated, tenant-scoped 1:1 direct messaging with media attachments, delivery
and read receipts, typing indicators and presence. PostgreSQL is the source of
truth; every write is fanned out through Apache Kafka, projected into MongoDB
(the read model), and pushed to both participants over Socket.IO.

### Features Implemented
- **1:1 direct messages**, scoped by `tenantId` + a deterministic `conversationId`.
- **JWT-authenticated** REST and WebSocket surfaces — identity is always taken
  from the verified session, never from the request payload.
- **Dual persistence**: synchronous write to PostgreSQL, asynchronous projection
  into MongoDB via Kafka.
- **Reads served from MongoDB**, with an automatic PostgreSQL fallback when Mongo
  is unreachable (the API response reports which store answered).
- **Receipts**: `SENT → DELIVERED → READ`, per message, with live updates.
- **Typing indicators** and **online presence** (transient, not persisted).
- **Media uploads** (images, video, PDF, plain text) up to 50MB.
- **Deletion**: for-me (per user) and for-everyone (sender only).
- **Per-conversation clear** that only affects the requesting user's view.

---

## Data Flow Architecture

```
Client (ChatDrawer.jsx)
    │
    │  socket.emit("chat:send", {...}, ack)      ← JWT-authenticated handshake
    ▼
lib/socket.js  ──►  services/chatSocket.service.js
                          │  identity = socket.user (verified), NOT the payload
                          ▼
                    services/message.service.js
                          │
                          ├─(1)─► repositories/message.repository.js
                          │         ▼
                          │       PostgreSQL `messages`   ◄── source of truth
                          │
                          └─(2)─► lib/kafka.js  publishKafkaEvent()
                                    topic: ueibi-chat-events
                                    key:   conversationId  (preserves ordering)
                                      ▼
                          services/messageKafkaConsumer.service.js
                                      │  applyChatEvent()
                                      ├──► MongoDB `chat_messages`  ◄── read model
                                      └──► emitToUser() × both participants
                                              "chat:message" etc.

  If the Kafka producer is offline, message.service calls applyChatEvent()
  inline (write-through), so the same projection + broadcast still runs.

Read path:  GET /api/messages?peerId=…
              ▼
            MongoDB  →  (unreachable?)  →  PostgreSQL
```

### Why both stores
PostgreSQL gives transactional durability and relational integrity with the rest
of the HR domain. MongoDB serves the read path: a conversation is a document
range scan on `{tenantId, conversationId, createdAt}`, and unread badges are a
single aggregation. Kafka decouples the two so a slow or down Mongo never blocks
a send, and the `conversationId` partition key keeps one conversation's events in
order.

---

## Conversation identity
`lib/conversation.js` derives the key both participants must agree on:

```
conversationIdFor(tenantId, userA, userB) => `${tenantId}:${min}__${max}`
```

The two user ids are **sorted** so each side computes the same value, and the
tenant is part of the key so a conversation can never span tenants.

---

## API Endpoints

All `/api/messages*` routes require a valid session (`requireAuth` + `requireTenant`).
Identity comes from the token; `userId` in a body or query string is ignored.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/messages?peerId=&limit=&before=` | Conversation history (Mongo, PG fallback) |
| `POST` | `/api/messages` | Send (REST fallback when the socket is down) |
| `GET` | `/api/messages/unread` | Unread counts grouped by conversation |
| `POST` | `/api/messages/read` | Mark a conversation read |
| `DELETE` | `/api/messages/clear` | Clear ONE conversation, for the caller only |
| `DELETE` | `/api/messages/:id/me` | Hide a message for the caller |
| `DELETE` | `/api/messages/:id/everyone` | Retract a message (sender only) |
| `POST` | `/api/media/upload` | Upload chat media (max 50MB, authenticated) |

## Socket events

**Client → server** (all acknowledged):

| Event | Payload |
|---|---|
| `chat:send` | `{ peerId, text, clientId, mediaUrl?, mediaType?, fileName?, fileSize? }` |
| `chat:read` | `{ peerId }` |
| `chat:delete` | `{ messageId, scope: 'me' \| 'everyone' }` |
| `chat:clear` | `{ peerId }` |
| `chat:typing` | `{ peerId, typing }` (fire-and-forget) |
| `chat:presence_check` | `{ peerId }` |

**Server → client** (delivered to per-user rooms only, never tenant-wide):

`chat:message`, `chat:message_deleted`, `chat:message_deleted_for_me`,
`chat:conversation_cleared`, `chat:conversation_read`, `chat:messages_delivered`,
`chat:typing`, `chat:presence`, `chat:presence_snapshot`

---

## Configuration

```
MONGODB_URI=mongodb://127.0.0.1:27017/ueibi
KAFKA_BROKERS=127.0.0.1:9092
KAFKA_TOPIC_CHAT=ueibi-chat-events
KAFKA_GROUP_ID_CHAT=ueibi-chat-consumer-group
```

Kafka and Zookeeper come from `docker-compose.yml`:

```
docker compose up -d zookeeper kafka mongodb
```

Neither is required to boot. Without Mongo, reads fall back to PostgreSQL;
without Kafka, events are applied inline. The startup banner reports which
components are live.

---

## Known limits
1. **Presence is per-instance.** `chatSocket.service.js` refcounts sockets in
   process memory, which is correct for the current single-node deployment.
   Running more than one API node would need a Socket.IO adapter and a shared
   presence store; Kafka already carries the message events, so only presence and
   typing (the transient signals that never touch Kafka) would need the adapter.
2. **1:1 only.** The `conversationId` scheme encodes exactly two participants;
   group chat needs a `Conversation` table with a participant join.
3. **Local disk storage** for uploads, not S3/R2.
4. **No end-to-end encryption.** Messages are encrypted in transit (TLS) but
   readable at rest by the server.
5. **Legacy rows.** The `20260917000000` migration parked pre-existing global
   messages under `tenantId = '__legacy__'` rather than deleting them. They are
   invisible to every tenant-scoped query and can be dropped once reviewed.
