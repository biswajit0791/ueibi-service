/**
 * sales.controller.js — Sales Pipeline, Leads & Representative Management.
 */
import { prisma } from '../lib/prisma.js';

export async function listSalesLeads(req, res, next) {
  try {
    const { stage, assignedToId, search } = req.query;
    const where = {};

    if (stage && stage !== 'ALL') where.stage = stage;
    if (assignedToId && assignedToId !== 'ALL') where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.salesLead.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const pipelineStages = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'PROPOSAL', 'WON', 'LOST'];
    const summaryByStage = {};
    for (const s of pipelineStages) {
      summaryByStage[s] = leads.filter((l) => l.stage === s).length;
    }

    const totalPipelineValue = leads
      .filter((l) => l.stage !== 'LOST')
      .reduce((sum, l) => sum + Number(l.dealValue || 0), 0);

    const wonValue = leads
      .filter((l) => l.stage === 'WON')
      .reduce((sum, l) => sum + Number(l.dealValue || 0), 0);

    res.json({
      items: leads,
      summary: {
        totalLeads: leads.length,
        totalPipelineValue,
        wonValue,
        byStage: summaryByStage,
        currency: 'INR',
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function createSalesLead(req, res, next) {
  try {
    const { companyName, contactName, email, phone, source, dealValue, estimatedSeats, notes, assignedToId } = req.body;

    if (!companyName || !contactName || !email) {
      return res.status(400).json({ error: 'Company Name, Contact Name, and Email are required' });
    }

    const lead = await prisma.salesLead.create({
      data: {
        companyName,
        contactName,
        email,
        phone: phone || null,
        source: source || 'INBOUND',
        dealValue: dealValue ? Number(dealValue) : 0,
        estimatedSeats: estimatedSeats ? Number(estimatedSeats) : 0,
        notes: notes || null,
        assignedToId: assignedToId || null,
        stage: 'NEW',
      },
    });

    res.status(201).json({ lead });
  } catch (err) {
    next(err);
  }
}

export async function updateSalesLead(req, res, next) {
  try {
    const { id } = req.params;
    const { stage, dealValue, estimatedSeats, notes, lostReason, assignedToId } = req.body;

    const data = {};
    if (stage) {
      data.stage = stage;
      if (stage === 'WON' || stage === 'LOST') data.closedAt = new Date();
    }
    if (dealValue !== undefined) data.dealValue = Number(dealValue);
    if (estimatedSeats !== undefined) data.estimatedSeats = Number(estimatedSeats);
    if (notes !== undefined) data.notes = notes;
    if (lostReason !== undefined) data.lostReason = lostReason;
    if (assignedToId !== undefined) data.assignedToId = assignedToId;

    const lead = await prisma.salesLead.update({
      where: { id },
      data,
    });

    res.json({ lead });
  } catch (err) {
    next(err);
  }
}

