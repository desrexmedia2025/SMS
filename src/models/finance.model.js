const db = require('../config/database');
const { toCents, fromCents } = require('../utils/currency');

async function getStudentFeeLedger(studentId, runner = db) {
  const assignments = await runner.query(
    `SELECT
       fa.*,
       fc.code AS fee_code,
       fc.name AS fee_name,
       fc.frequency,
       ay.name AS academic_year_name,
       tr.name AS term_name
     FROM fee_assignments fa
     INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
     INNER JOIN academic_years ay ON ay.id = fa.academic_year_id
     INNER JOIN terms tr ON tr.id = fa.term_id
     WHERE fa.student_id = ?
     ORDER BY fa.id ASC`,
    [studentId]
  );

  let totalBilledCents = 0;
  let totalDiscountCents = 0;
  let totalPaidCents = 0;

  const items = assignments.map((a) => {
    const dueCents = toCents(a.amount_due);
    const discCents = toCents(a.discount_amount);
    const paidCents = toCents(a.amount_paid);
    const netDueCents = Math.max(0, dueCents - discCents);
    const balanceCents = Math.max(0, netDueCents - paidCents);

    totalBilledCents += dueCents;
    totalDiscountCents += discCents;
    totalPaidCents += paidCents;

    return {
      ...a,
      net_due: fromCents(netDueCents),
      balance: fromCents(balanceCents),
    };
  });

  const netPayableCents = Math.max(0, totalBilledCents - totalDiscountCents);
  const outstandingCents = Math.max(0, netPayableCents - totalPaidCents);

  const payments = await runner.query(
    `SELECT
       p.*,
       r.id AS receipt_id,
       r.receipt_number,
       r.currency_code,
       r.currency_symbol,
       u.full_name AS cashier_name
     FROM payments p
     LEFT JOIN receipts r ON r.payment_id = p.id
     LEFT JOIN users u ON u.id = p.received_by_user_id
     WHERE p.student_id = ?
     ORDER BY p.id DESC`,
    [studentId]
  );

  const adjustments = await runner.query(
    `SELECT
       adj.*,
       fc.name AS fee_name,
       u.full_name AS approved_by_name
     FROM fee_adjustments adj
     INNER JOIN fee_assignments fa ON fa.id = adj.fee_assignment_id
     INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
     LEFT JOIN users u ON u.id = adj.approved_by_user_id
     WHERE adj.student_id = ?
     ORDER BY adj.id DESC`,
    [studentId]
  );

  return {
    summary: {
      totalBilled: fromCents(totalBilledCents),
      totalDiscount: fromCents(totalDiscountCents),
      netPayable: fromCents(netPayableCents),
      totalPaid: fromCents(totalPaidCents),
      outstandingBalance: fromCents(outstandingCents),
    },
    assignments: items,
    payments,
    adjustments,
  };
}

async function generateNextReceiptNumber(runner = db) {
  const year = new Date().getUTCFullYear();
  const prefix = `RCP-${year}-`;
  const latest = await runner.get(
    `SELECT receipt_number FROM receipts WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (latest && latest.receipt_number) {
    const tail = parseInt(latest.receipt_number.replace(prefix, ''), 10);
    if (Number.isInteger(tail) && tail >= 1) seq = tail + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

module.exports = {
  getStudentFeeLedger,
  generateNextReceiptNumber,
};
