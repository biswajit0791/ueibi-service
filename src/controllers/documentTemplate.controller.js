/**
 * @file documentTemplate.controller.js
 * @description Controller for Enterprise Document Template Engine.
 * Handles template authoring, versioning, token resolution, live HTML preview,
 * and high-fidelity PDF document generation.
 */

import { prisma } from '../lib/prisma.js';
import * as templateService from '../services/documentTemplate.service.js';
import * as tokenService from '../services/documentToken.service.js';
import * as rendererService from '../services/documentRenderer.service.js';
import * as schemas from '../validations/documentTemplate.schema.js';

/**
 * List all templates for the tenant with optional filtering.
 */
export async function listTemplates(req, res, next) {
  try {
    const { documentType, search, isActive } = req.query;
    const activeBool = isActive !== undefined ? isActive === 'true' : undefined;

    const templates = await templateService.getTemplatesByTenant({
      tenantId: req.tenantId,
      documentType,
      search,
      isActive: activeBool,
    });

    // Also include platform blueprints if no templates exist yet
    const typesPresent = new Set(templates.map((t) => t.documentType));
    const blueprints = Object.keys(templateService.DEFAULT_BLUEPRINTS)
      .filter((type) => !typesPresent.has(type))
      .map((type) => ({
        id: `blueprint-${type.toLowerCase()}`,
        tenantId: req.tenantId,
        ...templateService.DEFAULT_BLUEPRINTS[type],
        isDefault: true,
        isActive: true,
        isLocked: true,
        isBlueprint: true,
        version: 1,
        _count: { versions: 1, generatedDocs: 0 },
      }));

    res.json({
      templates: [...templates, ...blueprints],
      total: templates.length + blueprints.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(req, res, next) {
  try {
    const { id } = req.params;

    if (id.startsWith('blueprint-')) {
      const docType = id.replace('blueprint-', '').toUpperCase();
      const blueprint = templateService.DEFAULT_BLUEPRINTS[docType];
      if (!blueprint) {
        return res.status(404).json({ error: 'Blueprint template not found' });
      }
      return res.json({
        template: {
          id,
          tenantId: req.tenantId,
          ...blueprint,
          isDefault: true,
          isActive: true,
          isLocked: true,
          isBlueprint: true,
          version: 1,
          versions: [],
        },
      });
    }

    const template = await templateService.getTemplateById({
      id,
      tenantId: req.tenantId,
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ template });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a new document template.
 */
export async function createTemplate(req, res, next) {
  try {
    const parsed = schemas.createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid template payload', details: parsed.error.issues });
    }

    const template = await templateService.createTemplate({
      tenantId: req.tenantId,
      data: parsed.data,
      userId: req.user.id,
    });

    res.status(201).json({
      message: 'Template created successfully',
      template,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update an existing template draft.
 */
export async function updateTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = schemas.updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update payload', details: parsed.error.issues });
    }

    const updated = await templateService.updateTemplate({
      id,
      tenantId: req.tenantId,
      data: parsed.data,
      userId: req.user.id,
    });

    res.json({
      message: 'Template updated successfully',
      template: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Publish a new template version.
 */
export async function publishTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = schemas.publishTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid publish payload', details: parsed.error.issues });
    }

    const published = await templateService.publishTemplate({
      id,
      tenantId: req.tenantId,
      changeNote: parsed.data.changeNote,
      userId: req.user.id,
    });

    res.json({
      message: `Template published successfully as version ${published.version}`,
      template: published,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Clone an existing template.
 */
export async function cloneTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = schemas.cloneTemplateSchema.safeParse(req.body);
    const newName = parsed.success ? parsed.data.newName : undefined;

    const cloned = await templateService.cloneTemplate({
      id,
      tenantId: req.tenantId,
      newName,
      userId: req.user.id,
    });

    res.status(201).json({
      message: 'Template cloned successfully',
      template: cloned,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a template.
 */
export async function deleteTemplate(req, res, next) {
  try {
    const { id } = req.params;
    await templateService.deleteTemplate({ id, tenantId: req.tenantId });
    res.json({ message: 'Template deleted successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * Set a template as default for its type.
 */
export async function setDefaultTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await templateService.setDefaultTemplate({ id, tenantId: req.tenantId });
    res.json({ message: 'Template set as default', template: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * List versions of a template.
 */
export async function listVersions(req, res, next) {
  try {
    const { id } = req.params;
    const template = await prisma.documentTemplate.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ versions: template.versions });
  } catch (err) {
    next(err);
  }
}

/**
 * Roll back template to a previous version.
 */
export async function rollbackVersion(req, res, next) {
  try {
    const { id, version } = req.params;
    const rolledBack = await templateService.rollbackTemplateVersion({
      templateId: id,
      versionNumber: Number(version),
      tenantId: req.tenantId,
      userId: req.user.id,
    });

    res.json({
      message: `Template rolled back to version ${version}`,
      template: rolledBack,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get available dynamic tokens.
 */
export async function listTokens(req, res, next) {
  try {
    const { documentType } = req.query;
    const tokens = await tokenService.getAvailableTokens({
      tenantId: req.tenantId,
      documentType,
    });

    res.json({ tokens });
  } catch (err) {
    next(err);
  }
}

/**
 * Create a custom tenant token.
 */
export async function createCustomToken(req, res, next) {
  try {
    const parsed = schemas.customTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid token payload', details: parsed.error.issues });
    }

    const { token, label, group, description, dataSource, formatter, sampleValue, isRequired } = parsed.data;

    const created = await prisma.documentToken.create({
      data: {
        tenantId: req.tenantId,
        token,
        label,
        group: group || 'Custom',
        description,
        dataSource,
        formatter,
        sampleValue: sampleValue || token,
        isRequired: Boolean(isRequired),
        isCustom: true,
      },
    });

    res.status(201).json({ message: 'Token created successfully', token: created });
  } catch (err) {
    next(err);
  }
}

/**
 * Resolve tokens for an employee or exit record before generation.
 * This powers the Pre-Generation Review / Manual Edit modal!
 */
export async function resolveTokens(req, res, next) {
  try {
    const parsed = schemas.resolveTokensSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid resolve payload', details: parsed.error.issues });
    }

    const { documentType, employeeId, exitDetailsId } = parsed.data;
    const normalizedDocType = documentType ? String(documentType).toUpperCase() : undefined;

    const resolvedTokens = await tokenService.resolveTokensForEmployee({
      tenantId: req.tenantId,
      employeeId,
      exitDetailsId,
      currentUser: req.user,
      documentType: normalizedDocType,
    });

    // Also fetch the default template for this doc type so the modal can show the default wording
    const template = await templateService.getDefaultTemplate({
      tenantId: req.tenantId,
      documentType: normalizedDocType,
    });

    res.json({
      resolvedTokens,
      template,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Live HTML preview endpoint.
 * Accepts active editor states or templateId and outputs full rendered HTML.
 */
export async function previewDocument(req, res, next) {
  try {
    const parsed = schemas.previewTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[previewDocument] Validation Error:', JSON.stringify(parsed.error.issues));
      return res.status(400).json({ error: 'Invalid preview payload', details: parsed.error.issues });
    }

    const {
      templateId,
      htmlTemplate,
      headerHtml,
      footerHtml,
      cssStyles,
      layoutSettings,
      documentType,
      employeeId,
      exitDetailsId,
      manualOverrides,
    } = parsed.data;

    let targetTemplate;

    if (templateId) {
      if (templateId.startsWith('blueprint-')) {
        const type = templateId.replace('blueprint-', '').toUpperCase();
        targetTemplate = templateService.DEFAULT_BLUEPRINTS[type];
      } else {
        targetTemplate = await templateService.getTemplateById({
          id: templateId,
          tenantId: req.tenantId,
        });
      }
    }

    // Parse and normalize layoutSettings (can be object, stringified JSON, or null)
    let cleanLayoutSettings = layoutSettings != null ? layoutSettings : (targetTemplate?.layoutSettings || {});
    if (typeof cleanLayoutSettings === 'string') {
      try {
        cleanLayoutSettings = JSON.parse(cleanLayoutSettings);
      } catch {
        cleanLayoutSettings = {};
      }
    }

    const rawDocType = documentType || targetTemplate?.documentType || 'CUSTOM';
    const effectiveDocType = typeof rawDocType === 'string' ? rawDocType.toUpperCase() : 'CUSTOM';

    let safeOverrides = manualOverrides || {};
    if (typeof safeOverrides === 'string') {
      try {
        safeOverrides = JSON.parse(safeOverrides);
      } catch {
        safeOverrides = {};
      }
    }

    // Merge in-flight edits if sent from template builder canvas
    const effectiveTemplate = {
      name: targetTemplate?.name || 'Document Preview',
      documentType: effectiveDocType,
      htmlTemplate: htmlTemplate != null ? htmlTemplate : (targetTemplate?.htmlTemplate || ''),
      headerHtml: headerHtml != null ? headerHtml : (targetTemplate?.headerHtml || ''),
      footerHtml: footerHtml != null ? footerHtml : (targetTemplate?.footerHtml || ''),
      cssStyles: cssStyles != null ? cssStyles : (targetTemplate?.cssStyles || ''),
      layoutSettings: cleanLayoutSettings,
    };

    // Resolve sample or live tokens
    let tokenValues;
    if (employeeId || exitDetailsId) {
      tokenValues = await tokenService.resolveTokensForEmployee({
        tenantId: req.tenantId,
        employeeId,
        exitDetailsId,
        currentUser: req.user,
        documentType: effectiveTemplate.documentType,
      });
    } else {
      tokenValues = await tokenService.getSampleTokenView({
        tenantId: req.tenantId,
        documentType: effectiveTemplate.documentType,
      });
    }

    const result = rendererService.renderDocumentHtml({
      template: effectiveTemplate,
      tokenValues,
      manualOverrides: safeOverrides,
    });

    res.json({
      html: result.fullHtml,
      renderedBody: result.renderedBody,
      renderedHeader: result.renderedHeader,
      renderedFooter: result.renderedFooter,
      resolvedTokens: result.view,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Generate final PDF document, save audit record, and update linked records.
 */
export async function generateDocument(req, res, next) {
  try {
    const parsed = schemas.generateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid generation payload', details: parsed.error.issues });
    }

    const {
      templateId,
      documentType,
      employeeId,
      exitDetailsId,
      manualOverrides,
    } = parsed.data;

    const normalizedDocType = String(documentType || 'RELIEVING_LETTER').toUpperCase();

    let safeOverrides = manualOverrides || {};
    if (typeof safeOverrides === 'string') {
      try {
        safeOverrides = JSON.parse(safeOverrides);
      } catch {
        safeOverrides = {};
      }
    }

    // 1. Fetch template or default
    let template;
    if (templateId && !templateId.startsWith('blueprint-')) {
      template = await templateService.getTemplateById({
        id: templateId,
        tenantId: req.tenantId,
      });
    }

    if (!template) {
      template = await templateService.getDefaultTemplate({
        tenantId: req.tenantId,
        documentType: normalizedDocType,
      });
    }

    if (!template) {
      return res.status(404).json({ error: `No template available for document type: ${normalizedDocType}` });
    }

    // 2. Resolve token data
    const tokenValues = await tokenService.resolveTokensForEmployee({
      tenantId: req.tenantId,
      employeeId,
      exitDetailsId,
      currentUser: req.user,
      documentType: normalizedDocType,
    });

    // 3. Render PDF document
    const pdfResult = await rendererService.renderDocumentPdf({
      template,
      tokenValues,
      manualOverrides: safeOverrides,
      fileNamePrefix: normalizedDocType.toLowerCase().replace(/_letter|_certificate/g, ''),
    });

    // 4. Save GeneratedDocument record in DB for complete audit trail
    const isBlueprint = String(template.id).startsWith('blueprint-');
    const generatedDoc = await prisma.generatedDocument.create({
      data: {
        tenantId: req.tenantId,
        templateId: isBlueprint ? null : template.id,
        documentType,
        fileName: pdfResult.fileName,
        fileUrl: pdfResult.fileUrl,
        fileSize: pdfResult.fileSize,
        targetUserId: employeeId || null,
        targetUserName: pdfResult.view.employeeName || null,
        exitDetailsId: exitDetailsId || null,
        resolvedData: pdfResult.view,
        manualEdits: manualOverrides,
        generatedBy: req.user.name || req.user.email || 'Authorized User',
        templateVersion: template.version || 1,
      },
    });

    // 5. If this was generated for an ExitDetails record, sync URL onto exitDetails
    if (exitDetailsId) {
      const updateData = {};
      if (documentType === 'RELIEVING_LETTER') {
        updateData.relievingLetterUrl = pdfResult.fileUrl;
      } else if (documentType === 'SERVICE_CERTIFICATE') {
        updateData.serviceCertificateUrl = pdfResult.fileUrl;
      } else if (documentType === 'TERMINATION_LETTER') {
        try {
          const currentExit = await prisma.exitDetails.findUnique({
            where: { id: exitDetailsId },
            select: { feedbackRemarks: true },
          });
          let remarksObj = {};
          try {
            remarksObj = JSON.parse(currentExit?.feedbackRemarks || '{}');
          } catch {
            remarksObj = { notes: currentExit?.feedbackRemarks || '' };
          }
          remarksObj.terminationLetterUrl = pdfResult.fileUrl;
          updateData.feedbackRemarks = JSON.stringify(remarksObj);
        } catch {
          // ignore
        }
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.exitDetails.update({
          where: { id: exitDetailsId },
          data: updateData,
        });
      }
    }

    res.status(201).json({
      message: 'Document generated successfully',
      document: generatedDoc,
      fileUrl: pdfResult.fileUrl,
      fileName: pdfResult.fileName,
      resolvedTokens: pdfResult.view,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List generated document history for audit and downloads.
 */
export async function listGeneratedDocuments(req, res, next) {
  try {
    const { documentType, targetUserId, exitDetailsId, limit = 50 } = req.query;

    const where = { tenantId: req.tenantId };
    if (documentType) where.documentType = documentType;
    if (targetUserId) where.targetUserId = targetUserId;
    if (exitDetailsId) where.exitDetailsId = exitDetailsId;

    const documents = await prisma.generatedDocument.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      take: Number(limit),
      include: {
        template: {
          select: { name: true, slug: true, version: true },
        },
      },
    });

    res.json({ documents });
  } catch (err) {
    next(err);
  }
}
