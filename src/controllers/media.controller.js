import mediaService from '../services/media.service.js';

export class MediaController {
  async uploadFile(req, res) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
      }

      const host = req.get('host') || 'localhost:8000';
      const protocol = req.protocol || 'http';
      const baseUrl = `${protocol}://${host}`;

      const uploadedMedia = mediaService.processUpload(req.file, baseUrl);

      res.status(200).json({
        success: true,
        data: uploadedMedia,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Upload processing failed' });
    }
  }
}

export default new MediaController();
