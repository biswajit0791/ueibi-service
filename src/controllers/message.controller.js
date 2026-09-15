import messageService from '../services/message.service.js';

export class MessageController {
  async getMessages(req, res) {
    try {
      const userId = req.query.userId;
      const messages = await messageService.getMessages(userId);
      res.status(200).json({ success: true, data: messages });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  }

  async deleteForMe(req, res) {
    try {
      const id = req.params.id;
      const userId = req.body.userId;
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId is required' });
        return;
      }
      const updated = await messageService.deleteForMe(id, userId);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  }

  async deleteForEveryone(req, res) {
    try {
      const id = req.params.id;
      const updated = await messageService.deleteForEveryone(id);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  }

  async clearChat(_req, res) {
    try {
      await messageService.clearChat();
      res.status(200).json({ success: true, message: 'Chat cleared successfully' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  }
}

export default new MessageController();
