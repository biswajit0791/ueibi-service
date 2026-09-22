-- CXO ticket numbers are per-tenant, but the constraint was global.
--
-- nextTicketNumber() builds "CXO-<year>-<NNNN>" from a per-tenant COUNT, so
-- every tenant's first message is CXO-2026-0001. With a globally unique column
-- the second tenant to raise a message hit P2002 and the request failed.
--
-- The number is display-only (nothing looks a message up by it), so the fix is
-- to scope uniqueness the same way the number is generated.
DROP INDEX IF EXISTS "cxo_messages_ticketNumber_key";

CREATE UNIQUE INDEX "cxo_messages_tenantId_ticketNumber_key"
    ON "cxo_messages"("tenantId", "ticketNumber");
