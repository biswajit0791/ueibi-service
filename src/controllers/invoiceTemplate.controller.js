/**
 * invoiceTemplate.controller.js — authoring the printed invoice.
 *
 * Mirrors the legal document controller deliberately: same versioning, same
 * immutability rule, same sanitise-on-write. The reasons are the same too — an
 * invoice already sent to a customer must keep looking the way their copy
 * looks, so editing creates a new version rather than rewriting history.
 *
 * What is different is the compliance guard: publishing is refused when a
 * template is missing a field a GST invoice must legally carry, and the refusal
 * names the field and says why.
 */
import { prisma } from '../lib/prisma.js';
import { sanitizeLegalHtml } from '../lib/sanitizeHtml.js';
import {
  missingRequiredTokens,
  renderInvoiceTemplate,
  renderWithView,
  sampleInvoiceView,
  TOKEN_REFERENCE,
  REQUIRED_TOKENS,
} from '../services/invoiceTemplate.service.js';
import {
  templateSlugParamSchema,
  templateVersionParamSchema,
  templateCreateSchema,
  templateUpdateSchema,
  templateVersionWriteSchema,
  templatePreviewSchema,
  templateSettingsSchema,
} from '../validations/invoiceTemplate.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';
import {
  buildTemplateHtml,
  buildTemplateCss,
  normaliseSettings,
  disabledLockedSections,
  DEFAULT_SETTINGS,
  LOCKED_SECTIONS,
} from '../services/invoiceLayout.service.js';

/**
 * Turns designer settings into the stored markup.
 *
 * The designer sends settings; what is STORED is both the settings (so the form
 * can be reopened) and the generated HTML (so the render path is unchanged).
 * Locked sections are refused here as well as forced in the generator, because
 * a UI toggle is not a guarantee.
 */
function fromSettings(rawSettings) {
  const blocked = disabledLockedSections(rawSettings);
  if (blocked.length > 0) {
    const err = new Error(
      `A tax invoice cannot omit ${blocked.map((b) => b.section.replace(/^show/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()).join(', ')}.`,
    );
    err.statusCode = 400;
    err.code = 'LOCKED_SECTION_DISABLED';
    err.blocked = blocked;
    throw err;
  }
  const settings = normaliseSettings(rawSettings);
  return {
    settings,
    bodyHtml: buildTemplateHtml(settings),
    css: buildTemplateCss(settings),
  };
}

const PUBLISHED = { publishedAt: { not: null } };

/** The template version new invoices render with. */
export async function defaultTemplateVersion(client = prisma) {
  const tpl = await client.invoiceTemplate.findFirst({
    where: { isDefault: true },
    select: { slug: true },
  });
  if (!tpl) return null;
  return client.invoiceTemplateVersion.findFirst({
    where: { templateSlug: tpl.slug, ...PUBLISHED },
    orderBy: { version: 'desc' },
  });
}

/**
 * Sanitises a template body while leaving Mustache delimiters intact.
 *
 * The sanitiser escapes `{` and `}` in text nodes, which would turn every token
 * into literal text. They are swapped for placeholders that survive the pass
 * and swapped back afterwards, so the markup is cleaned without the template
 * language being destroyed by it.
 */
function sanitizeTemplate(html) {
  const OPEN = '__MUSTACHE_OPEN__';
  const CLOSE = '__MUSTACHE_CLOSE__';
  const masked = String(html || '')
    .replace(/\{\{/g, OPEN)
    .replace(/\}\}/g, CLOSE);
  return sanitizeLegalHtml(masked)
    .replace(new RegExp(OPEN, 'g'), '{{')
    .replace(new RegExp(CLOSE, 'g'), '}}');
}

/** GET /platform/invoice-templates */
export async function listTemplates(req, res, next) {
  try {
    const templates = await prisma.invoiceTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true, version: true, title: true, publishedAt: true,
            changeNote: true, createdAt: true, updatedAt: true,
          },
        },
      },
    });

    const usageRows = await prisma.invoice.groupBy({
      by: ['templateVersionId'],
      where: { templateVersionId: { not: null } },
      _count: { _all: true },
    });
    const usedBy = Object.fromEntries(usageRows.map((r) => [r.templateVersionId, r._count._all]));

    res.json({
      items: templates.map((t) => {
        const live = t.versions.find((v) => v.publishedAt);
        const draft = t.versions.find((v) => !v.publishedAt);
        return {
          slug: t.slug,
          title: t.title,
          description: t.description,
          isDefault: t.isDefault,
          createdAt: t.createdAt,
          published: live ? { ...live, invoicesRendered: usedBy[live.id] || 0 } : null,
          draft: draft || null,
          versionCount: t.versions.length,
          invoicesRendered: t.versions.reduce((a, v) => a + (usedBy[v.id] || 0), 0),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/invoice-templates/tokens — the editor's reference panel. */
export async function getTemplateTokens(req, res) {
  res.json({
    // What the designer can switch, and which switches are locked on because a
    // tax invoice legally requires them.
    defaults: DEFAULT_SETTINGS,
    locked: Object.entries(LOCKED_SECTIONS).map(([section, why]) => ({ section, why })),
    groups: TOKEN_REFERENCE.map(({ group, tokens }) => ({
      group,
      tokens: tokens.map(([token, description]) => ({ token, description })),
    })),
    required: REQUIRED_TOKENS.map(([token, what, why]) => ({ token, what, why })),
  });
}

/** GET /platform/invoice-templates/:slug */
export async function getTemplate(req, res, next) {
  try {
    const parsed = templateSlugParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const tpl = await prisma.invoiceTemplate.findUnique({
      where: { slug: parsed.data.slug },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const [usage, authors] = await Promise.all([
      prisma.invoice.groupBy({
        by: ['templateVersionId'],
        where: { templateVersionId: { in: tpl.versions.map((v) => v.id) } },
        _count: { _all: true },
      }),
      prisma.tenantUser.findMany({
        where: { id: { in: [...new Set(tpl.versions.map((v) => v.authorId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const usedBy = Object.fromEntries(usage.map((u) => [u.templateVersionId, u._count._all]));
    const nameOf = Object.fromEntries(authors.map((a) => [a.id, a.name]));

    res.json({
      template: {
        slug: tpl.slug, title: tpl.title, description: tpl.description,
        isDefault: tpl.isDefault, createdAt: tpl.createdAt,
      },
      versions: tpl.versions.map((v) => ({
        ...v,
        author: nameOf[v.authorId] || 'Deleted account',
        invoicesRendered: usedBy[v.id] || 0,
        immutable: Boolean(v.publishedAt),
        // Surfaced per version so the list can flag a published template that
        // predates a later change to what is required.
        missingTokens: missingRequiredTokens(v.bodyHtml),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/invoice-templates */
export async function createTemplate(req, res, next) {
  try {
    const parsed = templateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { slug, title, description } = parsed.data;

    const existing = await prisma.invoiceTemplate.findUnique({ where: { slug }, select: { slug: true } });
    if (existing) {
      return res.status(409).json({ error: `A template already exists at ${slug}`, code: 'SLUG_TAKEN' });
    }

    // The first template becomes the default, because a system with templates
    // and no default would silently keep using the built-in layout.
    const count = await prisma.invoiceTemplate.count();
    const tpl = await prisma.invoiceTemplate.create({
      data: { slug, title, description: description ?? null, isDefault: count === 0 },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_TEMPLATE_CREATED,
      targetType: 'INVOICE_TEMPLATE',
      targetId: slug,
      afterValue: { slug, title, isDefault: tpl.isDefault },
    }).catch((err) => console.warn('[Template] audit write failed:', err.message));

    res.status(201).json({ template: tpl });
  } catch (err) {
    next(err);
  }
}

/** PATCH /platform/invoice-templates/:slug — title, description, default. */
export async function updateTemplate(req, res, next) {
  try {
    const parsedParams = templateSlugParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const before = await prisma.invoiceTemplate.findUnique({
      where: { slug: parsedParams.data.slug },
      include: { versions: { where: PUBLISHED, take: 1 } },
    });
    if (!before) return res.status(404).json({ error: 'Template not found' });

    // Making an unpublished template the default would mean new invoices fall
    // back to the built-in layout while the console claims otherwise.
    if (parsed.data.isDefault === true && before.versions.length === 0) {
      return res.status(409).json({
        error: `${before.title} has no published version, so it cannot be the default. Publish a version first.`,
        code: 'TEMPLATE_NOT_PUBLISHED',
      });
    }

    const tpl = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault === true) {
        // Exactly one default, so the previous one is stood down in the same
        // transaction rather than leaving two.
        await tx.invoiceTemplate.updateMany({
          where: { isDefault: true, slug: { not: before.slug } },
          data: { isDefault: false },
        });
      }
      return tx.invoiceTemplate.update({ where: { slug: before.slug }, data: parsed.data });
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_TEMPLATE_UPDATED,
      targetType: 'INVOICE_TEMPLATE',
      targetId: tpl.slug,
      beforeValue: { title: before.title, isDefault: before.isDefault },
      afterValue: { title: tpl.title, isDefault: tpl.isDefault },
    }).catch((err) => console.warn('[Template] audit write failed:', err.message));

    res.json({ template: tpl });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/invoice-templates/:slug
 *
 * Refused once any invoice has been rendered with it: a reprint must reproduce
 * the customer's copy, and deleting the template would silently change what an
 * old invoice looks like.
 */
export async function deleteTemplate(req, res, next) {
  try {
    const parsed = templateSlugParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const tpl = await prisma.invoiceTemplate.findUnique({
      where: { slug: parsed.data.slug },
      include: { versions: { select: { id: true } } },
    });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const rendered = await prisma.invoice.count({
      where: { templateVersionId: { in: tpl.versions.map((v) => v.id) } },
    });
    if (rendered > 0) {
      return res.status(409).json({
        error: `${tpl.title} has rendered ${rendered} invoice(s). Deleting it would change how those look when reprinted.`,
        code: 'TEMPLATE_IN_USE',
        invoicesRendered: rendered,
      });
    }
    if (tpl.isDefault) {
      const others = await prisma.invoiceTemplate.count({ where: { slug: { not: tpl.slug } } });
      if (others > 0) {
        return res.status(409).json({
          error: 'This is the default template. Make another template the default first.',
          code: 'TEMPLATE_IS_DEFAULT',
        });
      }
    }

    await prisma.invoiceTemplate.delete({ where: { slug: tpl.slug } });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_TEMPLATE_DELETED,
      targetType: 'INVOICE_TEMPLATE',
      targetId: tpl.slug,
      beforeValue: { title: tpl.title, versions: tpl.versions.length },
    }).catch((err) => console.warn('[Template] audit write failed:', err.message));

    res.json({ deleted: true, title: tpl.title, versionsRemoved: tpl.versions.length });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/invoice-templates/:slug/versions — start a draft. */
export async function createTemplateVersion(req, res, next) {
  try {
    const parsedParams = templateSlugParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = templateVersionWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const tpl = await prisma.invoiceTemplate.findUnique({
      where: { slug: parsedParams.data.slug }, select: { slug: true },
    });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const openDraft = await prisma.invoiceTemplateVersion.findFirst({
      where: { templateSlug: tpl.slug, publishedAt: null },
      select: { id: true },
    });
    if (openDraft) {
      return res.status(409).json({
        error: 'A draft is already open for this template. Publish or discard it first.',
        code: 'DRAFT_EXISTS',
        versionId: openDraft.id,
      });
    }

    const highest = await prisma.invoiceTemplateVersion.findFirst({
      where: { templateSlug: tpl.slug },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    // The designer sends `settings`; a raw body is still accepted so the
    // seeded HTML template keeps working.
    const built = req.body?.settings ? fromSettings(req.body.settings) : null;

    const version = await prisma.invoiceTemplateVersion.create({
      data: {
        templateSlug: tpl.slug,
        version: (highest?.version || 0) + 1,
        title: parsed.data.title,
        settings: built ? built.settings : null,
        bodyHtml: sanitizeTemplate(built ? built.bodyHtml : parsed.data.bodyHtml),
        css: built ? built.css : (parsed.data.css ?? null),
        changeNote: parsed.data.changeNote ?? null,
        authorId: req.user.id,
      },
    });

    res.status(201).json({
      version,
      missingTokens: missingRequiredTokens(version.bodyHtml),
    });
  } catch (err) {
    if (err?.statusCode === 400 && err.code === 'LOCKED_SECTION_DISABLED') {
      return res.status(400).json({ error: err.message, code: err.code, blocked: err.blocked });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'That version number was just taken. Try again.' });
    }
    next(err);
  }
}

/** PATCH /platform/invoice-templates/:slug/versions/:versionId — edit a draft. */
export async function updateTemplateVersion(req, res, next) {
  try {
    const parsedParams = templateVersionParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = templateVersionWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const version = await prisma.invoiceTemplateVersion.findUnique({
      where: { id: parsedParams.data.versionId },
      select: { id: true, templateSlug: true, version: true, publishedAt: true },
    });
    if (!version || version.templateSlug !== parsedParams.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (version.publishedAt) {
      return res.status(409).json({
        error: `Version ${version.version} is published and cannot be changed. Start a new version — that is what keeps old invoices looking the way their customers received them.`,
        code: 'VERSION_PUBLISHED',
      });
    }

    const built = req.body?.settings ? fromSettings(req.body.settings) : null;

    const updated = await prisma.invoiceTemplateVersion.update({
      where: { id: version.id },
      data: {
        title: parsed.data.title,
        settings: built ? built.settings : undefined,
        bodyHtml: sanitizeTemplate(built ? built.bodyHtml : parsed.data.bodyHtml),
        css: built ? built.css : (parsed.data.css ?? null),
        changeNote: parsed.data.changeNote ?? null,
      },
    });

    res.json({ version: updated, missingTokens: missingRequiredTokens(updated.bodyHtml) });
  } catch (err) {
    if (err?.statusCode === 400 && err.code === 'LOCKED_SECTION_DISABLED') {
      return res.status(400).json({ error: err.message, code: err.code, blocked: err.blocked });
    }
    next(err);
  }
}

/**
 * POST /platform/invoice-templates/:slug/versions/:versionId/publish
 *
 * The compliance guard lives here. A template missing a legally required field
 * is refused, naming each missing field and why it is needed.
 */
export async function publishTemplateVersion(req, res, next) {
  try {
    const parsed = templateVersionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const version = await prisma.invoiceTemplateVersion.findUnique({
      where: { id: parsed.data.versionId },
    });
    if (!version || version.templateSlug !== parsed.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (version.publishedAt) {
      return res.status(409).json({ error: `Version ${version.version} is already published` });
    }

    const missing = missingRequiredTokens(version.bodyHtml);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `This template is missing ${missing.length} field(s) a tax invoice must carry: ${missing.map((m) => m.what).join(', ')}. Add them before publishing.`,
        code: 'MISSING_REQUIRED_TOKENS',
        missingTokens: missing,
      });
    }

    // A template that throws at render time would break every invoice, so it is
    // rendered against sample data before it is allowed to go live.
    const probe = renderInvoiceTemplate(version.bodyHtml, {});
    if (probe.error) {
      return res.status(400).json({
        error: `This template does not render: ${probe.error}`,
        code: 'TEMPLATE_INVALID',
      });
    }

    const previous = await prisma.invoiceTemplateVersion.findFirst({
      where: { templateSlug: version.templateSlug, ...PUBLISHED },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const published = await prisma.invoiceTemplateVersion.update({
      where: { id: version.id },
      data: { publishedAt: new Date() },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_TEMPLATE_PUBLISHED,
      targetType: 'INVOICE_TEMPLATE',
      targetId: version.templateSlug,
      beforeValue: previous ? { version: previous.version } : null,
      afterValue: { version: published.version },
      reason: version.changeNote || null,
    }).catch((err) => console.warn('[Template] audit write failed:', err.message));

    res.json({
      version: published,
      note: previous
        ? `Version ${published.version} is live. Invoices already rendered with version ${previous.version} still print that way.`
        : `Version ${published.version} is live and will be used for new invoices.`,
    });
  } catch (err) {
    next(err);
  }
}

/** DELETE /platform/invoice-templates/:slug/versions/:versionId — discard a draft. */
export async function deleteTemplateVersion(req, res, next) {
  try {
    const parsed = templateVersionParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const version = await prisma.invoiceTemplateVersion.findUnique({
      where: { id: parsed.data.versionId },
      select: { id: true, templateSlug: true, version: true, publishedAt: true },
    });
    if (!version || version.templateSlug !== parsed.data.slug) {
      return res.status(404).json({ error: 'Version not found' });
    }
    if (version.publishedAt) {
      return res.status(409).json({
        error: `Version ${version.version} is published and cannot be deleted.`,
        code: 'VERSION_PUBLISHED',
      });
    }

    await prisma.invoiceTemplateVersion.delete({ where: { id: version.id } });
    res.json({ deleted: true, version: version.version });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoice-templates/preview
 *
 * Renders arbitrary template text against a real invoice, or sample data when
 * none is given. Nothing is stored, so the author can see the result before
 * committing to a draft.
 */
export async function previewTemplate(req, res, next) {
  try {
    const parsed = templatePreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { css, invoiceId } = parsed.data;
    // Designer previews send settings; the HTML is generated the same way it
    // will be when saved, so what is previewed is what gets stored.
    const built = req.body?.settings ? fromSettings(req.body.settings) : null;
    const bodyHtml = built ? built.bodyHtml : parsed.data.bodyHtml;

    let invoice = null;
    if (invoiceId) {
      invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          payments: { orderBy: { receivedAt: 'desc' } },
          refunds: { orderBy: { refundedAt: 'desc' } },
          subscription: { select: { packageName: true, startsAt: true, endsAt: true } },
        },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    }

    const { html, error } = invoice
      ? renderInvoiceTemplate(bodyHtml, invoice)
      : renderWithView(bodyHtml, sampleInvoiceView());

    res.json({
      html: html ? sanitizeLegalHtml(html) : null,
      css: built ? built.css : (css || null),
      error,
      missingTokens: missingRequiredTokens(bodyHtml),
      usingSampleData: !invoice,
    });
  } catch (err) {
    // Same structured refusal as the write paths: the generic handler would
    // pass the status and code through but drop which sections were blocked,
    // which is the only part the designer can act on.
    if (err?.statusCode === 400 && err.code === 'LOCKED_SECTION_DISABLED') {
      return res.status(400).json({ error: err.message, code: err.code, blocked: err.blocked });
    }
    next(err);
  }
}
