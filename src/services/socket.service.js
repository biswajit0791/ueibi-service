import { Server } from 'socket.io';
import { pub, sub } from './redis.service.js';
import messageService from './message.service.js';

class SocketService {
  constructor() {
    this._io = new Server({
      cors: { allowedHeaders: ['*'], origin: '*' },
    });
  }

  get io() {
    return this._io;
  }

  initEventListeners() {
    const io = this._io;

    io.on('connect', (socket) => {
      console.log(`Connected client: ${socket.id}`);

      socket.on('event:message', async (data) => {
        const id = `${socket.id}-${Date.now()}`;
        const createdAt = new Date().toISOString();
        const senderId = data.senderId || socket.id;

        const payload = {
          id,
          msg: data.msg || '',
          senderId,
          mediaUrl: data.mediaUrl ?? null,
          mediaType: data.mediaType ?? null,
          fileName: data.fileName ?? null,
          fileSize: data.fileSize ?? null,
          createdAt,
          isDeleted: false,
          deletedFor: [],
        };

        try {
          await messageService.saveMessage({
            id: payload.id,
            senderId: payload.senderId,
            text: payload.msg,
            mediaUrl: payload.mediaUrl ?? undefined,
            mediaType: payload.mediaType ?? undefined,
            fileName: payload.fileName ?? undefined,
            fileSize: payload.fileSize ?? undefined,
            createdAt: new Date(payload.createdAt),
          });
        } catch (err) {
          console.error('❌ DB save error:', err);
        }

        try {
          await pub.publish('MESSAGES', JSON.stringify({ type: 'CHAT_MSG', payload }));
        } catch (err) {
          console.error('❌ Redis publish error:', err);
          io.emit('message', payload);
        }
      });

      socket.on('event:delete_message', async (data) => {
        const userId = data.userId || socket.id;
        try {
          if (data.type === 'everyone') {
            await messageService.deleteForEveryone(data.messageId);
            await pub.publish(
              'MESSAGES',
              JSON.stringify({
                type: 'DELETE_EVERYONE',
                payload: { messageId: data.messageId },
              }),
            );
          } else {
            await messageService.deleteForMe(data.messageId, userId);
            socket.emit('message_deleted_for_me', { messageId: data.messageId });
          }
        } catch (err) {
          console.error('❌ Delete message socket error:', err);
        }
      });

      socket.on('event:clear_chat', async () => {
        try {
          await messageService.clearChat();
          await pub.publish('MESSAGES', JSON.stringify({ type: 'CLEAR_CHAT' }));
        } catch (err) {
          console.error('❌ Clear chat socket error:', err);
        }
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });

    try {
      if (sub.status === 'wait') sub.connect().catch(() => {});
      if (pub.status === 'wait') pub.connect().catch(() => {});
      sub.subscribe('MESSAGES', (err) => {
        if (err) console.error('❌ Failed to subscribe to MESSAGES:', err.message);
      });
    } catch (err) {
      console.warn('⚠️ Redis connection init warning:', err.message);
    }

    sub.on('message', (channel, messageStr) => {
      if (channel === 'MESSAGES') {
        try {
          const parsed = JSON.parse(messageStr);
          if (parsed.type === 'CHAT_MSG') {
            io.emit('message', parsed.payload);
          } else if (parsed.type === 'DELETE_EVERYONE') {
            io.emit('message_deleted_everyone', parsed.payload);
          } else if (parsed.type === 'CLEAR_CHAT') {
            io.emit('chat_cleared');
          } else {
            io.emit('message', parsed);
          }
        } catch {
          io.emit('message', messageStr);
        }
      }
    });
  }
}

export default SocketService;
