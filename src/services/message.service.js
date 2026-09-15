import messageRepository from '../repositories/message.repository.js';

export class MessageService {
  async saveMessage(dto) {
    if (!dto.text && !dto.mediaUrl) {
      throw new Error('Message text or media is required');
    }
    return messageRepository.create(dto);
  }

  async getMessages(userId) {
    return messageRepository.findAll(userId);
  }

  async deleteForMe(messageId, userId) {
    if (!messageId || !userId) {
      throw new Error('Message ID and User ID are required');
    }
    return messageRepository.deleteForUser(messageId, userId);
  }

  async deleteForEveryone(messageId) {
    if (!messageId) {
      throw new Error('Message ID is required');
    }
    return messageRepository.deleteForEveryone(messageId);
  }

  async clearChat() {
    return messageRepository.deleteAll();
  }
}

export default new MessageService();
