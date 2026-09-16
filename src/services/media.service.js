export class MediaService {
  getMediaType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    return 'file';
  }

  processUpload(file, baseUrl) {
    const mediaType = this.getMediaType(file.mimetype);
    const mediaUrl = `${baseUrl}/uploads/${file.filename}`;

    return {
      mediaUrl,
      mediaType,
      fileName: file.originalname,
      fileSize: file.size,
    };
  }
}

export default new MediaService();
