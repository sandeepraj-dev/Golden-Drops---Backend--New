import PDFDocument from 'pdfkit';import BusinessSettings from '../models/BusinessSettings.js';export async function makeBill(res,bill,type){const settings=await BusinessSettings.findOne({key:'main'});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename=${type==='PURCHASE'?bill.purchaseNumber:bill.saleNumber}.pdf`);const doc=new PDFDocument({margin:48});doc.pipe(res);doc.fontSize(20).text(settings?.businessName||process.env.BUSINESS_NAME||'Oil Broker Business');doc.moveDown().fontSize(15).text(type==='PURCHASE'?'PURCHASE BILL':'SALES BILL');doc.fontSize(10).text(`Bill No: ${type==='PURCHASE'?bill.purchaseNumber:bill.saleNumber}`);doc.text(`Date: ${(type==='PURCHASE'?bill.purchaseDate:bill.saleDate).toISOString().slice(0,10)}`);doc.moveDown();if(type==='PURCHASE'){doc.text(`Manufacturer: ${bill.manufacturerSnapshot.name}`);doc.text(`Oil: ${bill.oilSnapshot.name}`);doc.text(`Quantity: ${bill.quantityKg} KG`);doc.text(`Rate: ₹${(bill.purchasePricePaisePerKg/100).toFixed(2)}/KG`);doc.text(`Total: ₹${(bill.totalPaise/100).toFixed(2)}`);doc.text(`Paid: ₹${(bill.totalPaidPaise/100).toFixed(2)}`);doc.text(`Outstanding: ₹${(bill.outstandingPaise/100).toFixed(2)}`)}else{doc.text(`Supplier: ${bill.supplierSnapshot.name}`);doc.moveDown();for(const i of bill.items)doc.text(`${i.oilSnapshot.name} | ${i.quantityKg} KG × ₹${(i.sellingPricePaisePerKg/100).toFixed(2)} = ₹${(i.lineTotalPaise/100).toFixed(2)}`);doc.moveDown().text(`Grand total: ₹${(bill.grandTotalPaise/100).toFixed(2)}`).text(`Cost of goods sold: ₹${(bill.totalCostPaise/100).toFixed(2)}`).text(`Gross profit: ₹${(bill.grossProfitPaise/100).toFixed(2)}`).text(`Paid: ₹${(bill.totalPaidPaise/100).toFixed(2)}`).text(`Outstanding: ₹${(bill.outstandingPaise/100).toFixed(2)}`)}doc.end()}


// Downloadable PDF report for bulk sales history.
export async function makeBulkSalesReport(res, sales) {
  const settings = await BusinessSettings.findOne({ key: 'main' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=bulk-sales-report.pdf');
  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  doc.pipe(res);
  doc.fontSize(19).text(settings?.businessName || process.env.BUSINESS_NAME || 'Oil Broker Business');
  doc.moveDown(0.3).fontSize(15).text('BULK SALES REPORT');
  doc.fontSize(9).text(`Generated: ${new Date().toLocaleString('en-IN')}`);
  doc.moveDown();
  if (!sales.length) { doc.fontSize(11).text('No bulk sales found for the selected filters.'); doc.end(); return; }
  let grandTotal = 0, totalQty = 0, totalProfit = 0, totalOutstanding = 0;
  for (const sale of sales) {
    if (doc.y > 700) doc.addPage();
    const total = Number(sale.grandTotalPaise || 0) / 100;
    const qty = Number(sale.totalQuantityKg || 0);
    const profit = Number(sale.grossProfitPaise || 0) / 100;
    const outstanding = Number(sale.outstandingPaise || 0) / 100;
    grandTotal += total; totalQty += qty; totalProfit += profit; totalOutstanding += outstanding;
    doc.fontSize(11).text(`${sale.saleNumber || `SALE-${sale.id}`} | ${new Date(sale.saleDate).toLocaleDateString('en-IN')} | ${sale.supplierSnapshot?.name || `Supplier ${sale.supplierId}`}`, { continued: false });
    doc.fontSize(9).text(`Items: ${(sale.items || []).length} | Total quantity: ${qty.toFixed(3)} KG | Bill total: ₹${total.toFixed(2)} | Profit: ₹${profit.toFixed(2)} | Due: ₹${outstanding.toFixed(2)}`);
    for (const item of (sale.items || [])) {
      doc.text(`  • ${item.oilSnapshot?.name || `Oil ${item.oilTypeId}`} — ${Number(item.quantityKg || 0).toFixed(3)} KG × ₹${(Number(item.sellingPricePaisePerKg || 0)/100).toFixed(2)} = ₹${(Number(item.lineTotalPaise || 0)/100).toFixed(2)}`);
    }
    doc.moveDown(0.6);
  }
  if (doc.y > 680) doc.addPage();
  doc.moveDown().fontSize(12).text('REPORT TOTALS', { underline: true });
  doc.fontSize(10).text(`Bulk bills: ${sales.length}`);
  doc.text(`Total quantity: ${totalQty.toFixed(3)} KG`);
  doc.text(`Total sales: ₹${grandTotal.toFixed(2)}`);
  doc.text(`Gross profit: ₹${totalProfit.toFixed(2)}`);
  doc.text(`Outstanding: ₹${totalOutstanding.toFixed(2)}`);
  doc.end();
}
