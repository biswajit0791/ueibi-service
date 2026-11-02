/**
 * webhook.controller.js — Idempotent webhook receiver for payment gateways (Razorpay).
 *
 * Verifies HMAC SHA256 signatures, deduplicates via WebhookEvent, and executes
 * atomic invoice transitions and receipt records inside a database transaction.
 */
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

export async function handleRazorpayWebhook(req, res) {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_KEY_SECRET;

    if (!signature || !secret) {
      return res.status(400).json({ error: 'Missing webhook signature or secret configuration' });
    }

    // Verify HMAC SHA256 signature
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const { event, payload } = req.body;
    const eventId = req.headers['x-razorpay-event-id'] || `${event}_${Date.now()}`;

    // 1. Idempotency Check: Don't process the same event twice
    const existing = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existing && existing.processed) {
      return res.status(200).json({ status: 'already_processed', eventId });
    }

    const webhookRecord = existing || await prisma.webhookEvent.create({
      data: {
        provider: 'RAZORPAY',
        eventId,
        eventType: event,
        payload: req.body,
        processed: false,
      },
    });

    // 2. Process Specific Events
    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload?.payment?.entity;
      const orderId = paymentEntity?.order_id || payload?.order?.entity?.id;
      const notes = paymentEntity?.notes || payload?.order?.entity?.notes || {};
      const amountInRupees = (paymentEntity?.amount || payload?.order?.entity?.amount || 0) / 100;
      const paymentRef = paymentEntity?.id || eventId;

      // Match invoice by invoiceId note or registrationId
      let invoice = null;
      if (notes.invoiceId) {
        invoice = await prisma.invoice.findUnique({ where: { id: notes.invoiceId } });
      } else if (notes.registrationId) {
        invoice = await prisma.invoice.findFirst({
          where: { registrationId: notes.registrationId, state: { not: 'VOID' } },
        });
      }

      if (invoice && invoice.state !== 'PAID' && invoice.state !== 'VOID') {
        await prisma.$transaction(async (tx) => {
          // Record payment
          await tx.payment.create({
            data: {
              invoiceId: invoice.id,
              tenantId: invoice.tenantId,
              amount: amountInRupees,
              method: 'RAZORPAY',
              reference: paymentRef,
              receivedAt: new Date(),
              notes: `Auto-recorded via webhook for order ${orderId}`,
            },
          });

          const newAmountPaid = Number(invoice.amountPaid) + amountInRupees;
          const isFullyPaid = newAmountPaid >= Number(invoice.totalAmount);

          // Update invoice state
          await tx.invoice.update({
            where: { id: invoice.id },
            data: {
              amountPaid: newAmountPaid,
              state: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            },
          });
        });
      }
    }

    // Mark webhook as processed
    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: { processed: true, processedAt: new Date() },
    });

    return res.status(200).json({ status: 'success', eventId });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    return res.status(500).json({ error: 'Webhook processing failed', message: err.message });
  }
}

