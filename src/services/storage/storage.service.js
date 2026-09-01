import { LocalStorageProvider } from './localStorage.provider.js';

// Configuration & Security Constraints
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit

const DISALLOWED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.js', '.vbs', '.php', '.py',
  '.dll', '.com', '.scr', '.jar', '.vbe', '.jse', '.wsf', '.wsh',
  '.msi', '.pif', '.reg', '.hta', '.cpl', '.apk'
]);

export class StorageService {
  constructor() {
    // Current provider is LocalStorageProvider; can switch to S3StorageProvider when configured
    this.provider = new LocalStorageProvider(process.env.UPLOAD_DIR || './uploads');
  }

  /**
   * Validates file before passing to storage provider.
   */
  validateFile({ buffer, originalName, size, mimeType }) {
    const actualSize = size || (buffer ? buffer.length : 0);
    if (actualSize > MAX_FILE_SIZE) {
      throw { status: 400, message: `File size exceeds the 10MB limit (File size: ${(actualSize / 1024 / 1024).toFixed(2)} MB)` };
    }

    if (originalName) {
      const extIndex = originalName.lastIndexOf('.');
      if (extIndex !== -1) {
        const ext = originalName.slice(extIndex).toLowerCase();
        if (DISALLOWED_EXTENSIONS.has(ext)) {
          throw { status: 400, message: `Executable or script file type "${ext}" is not permitted for upload` };
        }
      }
    }
  }

  /**
   * Stores a file attachment with tenant & task isolation.
   */
  async save({ tenantId, taskId, buffer, originalName, mimeType, size }) {
    this.validateFile({ buffer, originalName, size, mimeType });
    return this.provider.save({ tenantId, taskId, buffer, originalName, mimeType, size });
  }

  /**
   * Returns a readable stream for file download.
   */
  async getDownloadStream(storageKey) {
    if (!storageKey) {
      throw { status: 400, message: 'Storage key is required' };
    }
    return this.provider.getDownloadStream(storageKey);
  }

  /**
   * Deletes a stored file.
   */
  async delete(storageKey) {
    if (!storageKey) return false;
    return this.provider.delete(storageKey);
  }

  /**
   * Checks file existence.
   */
  async exists(storageKey) {
    if (!storageKey) return false;
    return this.provider.exists(storageKey);
  }
}

export const storageService = new StorageService();
