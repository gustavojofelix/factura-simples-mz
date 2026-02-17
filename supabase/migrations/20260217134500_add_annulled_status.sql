-- Adicionar o status 'anulada' à restrição de status das facturas
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE invoices ADD CONSTRAINT valid_status 
CHECK (status IN ('rascunho', 'pendente', 'paga', 'vencida', 'anulada'));
