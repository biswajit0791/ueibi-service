import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class LocalStorageProvider {
  constructor(baseDir = './uploads') {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Sanitizes original filename to prevent path traversal and unsafe characters.
   */
  sanitizeFilename(name) {
    const parsed = path.parse(name || 'file');
    const safeBase = parsed.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const safeExt = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase().slice(0, 10);
    return `${safeBase || 'attachment'}${safeExt}`;
  }

  /**
   * Resolves storage key to absolute safe path and verifies boundary.
   */
  resolvePath(storageKey) {
    const safeKey = path.normalize(storageKey).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.resolve(this.baseDir, safeKey);
    if (!absolutePath.startsWith(this.baseDir)) {
      throw { status: 400, message: 'Invalid storage key path traversal' };
    }
    return absolutePath;
  }

  /**
   * Saves a file into uploads/tenants/<tenantId>/tasks/<taskId>/<storedName>
   */
  async save({ tenantId, taskId, buffer, originalName, mimeType, size }) {
    if (!tenantId || !taskId) {
      throw { status: 400, message: 'Tenant ID and Task ID are required for file storage' };
    }

    const cleanOriginal = originalName ? path.basename(originalName) : 'attachment';
    const sanitized = this.sanitizeFilename(cleanOriginal);
    const uniquePrefix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const storedName = `${uniquePrefix}-${sanitized}`;

    const relativeDir = path.join('tenants', tenantId, 'tasks', taskId);
    const absoluteDir = path.resolve(this.baseDir, relativeDir);

    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }

    const absoluteFilePath = path.join(absoluteDir, storedName);
    await fs.promises.writeFile(absoluteFilePath, buffer);

    const actualSize = size || (buffer ? buffer.length : 0);
    const storageKey = path.join('tenants', tenantId, 'tasks', taskId, storedName).replace(/\\/g, '/');

    return {
      originalName: cleanOriginal,
      storedName,
      mimeType: mimeType || 'application/octet-stream',
      size: actualSize,
      storageKey,
      storageProvider: 'LOCAL',
    };
  }

  /**
   * Returns a readable stream for the attachment.
   */
  async getDownloadStream(storageKey) {
    const absolutePath = this.resolvePath(storageKey);
    if (!fs.existsSync(absolutePath)) {
      throw { status: 404, message: 'Attachment file not found on server' };
    }
    return fs.createReadStream(absolutePath);
  }

  /**
   * Deletes a stored file from disk.
   */
  async delete(storageKey) {
    try {
      const absolutePath = this.resolvePath(storageKey);
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`[LocalStorageProvider] Failed to delete file ${storageKey}:`, err.message);
      return false;
    }
  }

  /**
   * Checks if file exists on disk.
   */
  async exists(storageKey) {
    const absolutePath = this.resolvePath(storageKey);
    return fs.existsSync(absolutePath);
  }
}
