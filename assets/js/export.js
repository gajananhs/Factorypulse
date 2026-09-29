/* FactoryPulse — PDF download and WhatsApp share for any report object. */
(function () {
  'use strict';
  const FP = window.FP;

  const BLUE = [29, 95, 209];
  const INK = [23, 33, 44];
  const MUTED = [110, 122, 136];
  const LINE = [216, 222, 230];
  const TINT = [238, 244, 254];
  const ZEBRA = [246, 248, 250];
  const STATUS_RGB = { 'is-good': [30, 138, 76], 'is-warn': [168, 111, 6], 'is-bad': [196, 56, 45] };

  /* Standard PDF fonts cover Western characters only; replace anything else. */
  const T = (v) => String(v ?? '')
    .replace(/[×]/g, 'x').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u2014\u2022\u20AC]/g, '?');

  function ensureData(r) {
    if (!r.machines || !r.machines.length) {
      FP.toast('Add at least one machine line first.', { type: 'error' });
      return false;
    }
    return true;
  }

  function fileName(r) {
    const base = r.report_no || 'DPR-draft';
    return `${base}_${r.report_date || FP.today()}_${(r.shift || '').replace(/\s+/g, '')}.pdf`.replace(/[^\w.\-]/g, '_');
  }

  /* ---------------------------------------------------------------- PDF */
  function buildPdf(r) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 14;
    const CW = W - M * 2;
    const cx = W / 2;
    const k = FP.computeKpis(r);
    const generated = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

    const baseTable = {
      theme: 'grid',
      margin: { left: M, right: M, top: 18, bottom: 18 },
      styles: { font: 'helvetica', fontSize: 8.5, halign: 'center', valign: 'middle', cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: ZEBRA },
    };
    const centeredMargin = (width) => ({ ...baseTable.margin, left: (W - width) / 2, right: (W - width) / 2 });
    let y;

    const ensureSpace = (need) => { if (y + need > H - 20) { doc.addPage(); y = 20; } };

    const heading = (text) => {
      ensureSpace(22);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
      doc.text(T(text), cx, y, { align: 'center' });
      doc.setDrawColor(...BLUE); doc.setLineWidth(0.7);
      doc.line(cx - 12, y + 2.2, cx + 12, y + 2.2);
      y += 6.5;
    };

    /* Header band */
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, W, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
    doc.text('Daily Production Report', cx, 14, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const place = [r.plant_name, r.section].filter(Boolean).join('  |  ') || 'Production';
    doc.text(T(place), cx, 21.5, { align: 'center' });
    doc.setFontSize(9.5);
    doc.text(T(`${r.report_no ? 'Report no. ' + r.report_no : 'Draft, not saved'}   |   ${FP.fmtDate(r.report_date)}   |   ${FP.shiftLabel(r.shift)}`), cx, 28.5, { align: 'center' });
    y = 44;

    /* Report details */
    doc.autoTable({
      ...baseTable,
      theme: 'grid',
      startY: y,
      body: [
        ['Report date', FP.fmtDate(r.report_date), 'Shift', FP.shiftLabel(r.shift)],
        ['Plant', r.plant_name || '-', 'Section / line', r.section || '-'],
        ['Supervisor', r.supervisor || '-', 'Planned time', `${FP.fmtNum(r.planned_minutes)} min per machine`],
        ['Manpower', r.manpower_required ? `${r.manpower_present} present of ${r.manpower_required} required` : '-', 'Overtime', r.overtime_hours ? `${r.overtime_hours} h` : '-'],
        ['Prepared by', r.prepared_by || '-', 'Saved on', r.created_at ? FP.fmtDateTime(r.created_at) : 'Not saved'],
      ].map((row) => row.map(T)),
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: ZEBRA, textColor: MUTED, cellWidth: CW * 0.18 },
        1: { cellWidth: CW * 0.32 },
        2: { fontStyle: 'bold', fillColor: ZEBRA, textColor: MUTED, cellWidth: CW * 0.18 },
        3: { cellWidth: CW * 0.32 },
      },
      alternateRowStyles: {},
    });
    y = doc.lastAutoTable.finalY + 10;

    /* KPI boxes (2 rows x 4) */
    heading('Shift performance');
    const kpis = [
      ['Plan attainment', FP.fmtPct(k.attainment), FP.statusOf('attainment', k.attainment)],
      ['OEE', FP.fmtPct(k.oee), FP.statusOf('oee', k.oee)],
      ['Availability', FP.fmtPct(k.availability), FP.statusOf('availability', k.availability)],
      ['Performance', FP.fmtPct(k.performance), FP.statusOf('performance', k.performance)],
      ['Quality', FP.fmtPct(k.quality), FP.statusOf('quality', k.quality)],
      ['Rejection', FP.fmtPct(k.rejection), FP.statusOf('rejection', k.rejection)],
      ['Good output', `${FP.fmtNum(k.good)} pcs`, ''],
      ['Downtime', `${FP.fmtNum(k.down)} min`, FP.statusOf('downtimePct', k.downtimePct)],
    ];
    const gap = 4, bw = (CW - gap * 3) / 4, bh = 19;
    ensureSpace(bh * 2 + gap + 4);
    kpis.forEach(([label, value, cls], i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = M + col * (bw + gap), by = y + row * (bh + gap);
      doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
      doc.roundedRect(x, by, bw, bh, 2.5, 2.5, 'FD');
      const c = STATUS_RGB[cls];
      if (c) { doc.setFillColor(...c); doc.rect(x + 6, by, bw - 12, 1.1, 'F'); }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14.5); doc.setTextColor(...(c || INK));
      doc.text(T(value), x + bw / 2, by + 10, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(T(label), x + bw / 2, by + 15.5, { align: 'center' });
    });
    y += bh * 2 + gap + 5;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('OEE = Availability x Performance x Quality. Colour bar: green on track, amber watch, red act now.', cx, y, { align: 'center' });
    y += 9;

    /* Machine-wise production */
    heading('Machine-wise production');
    doc.autoTable({
      ...baseTable,
      startY: y,
      head: [['#', 'Machine', 'Part / item', 'Operator', 'Planned', 'Good', 'Reject', 'Cycle (s)', 'Down (min)', 'Actual run (s)', 'Attain.', 'Eff.', 'Cyc T.']],
      body: r.machines.map((m, i) => {
        const att = m.planned_qty ? (m.good_qty / m.planned_qty) * 100 : null;
        const runSec = m.actual_run_sec || 0;
        const eff = runSec > 0 ? ((28800 * (m.good_qty + m.reject_qty)) / runSec) * 100 : null;
        const cyc = runSec > 0 ? (28800 * m.planned_qty) / runSec : null;
        return [i + 1, m.machine, m.item || '-', m.operator || '-', FP.fmtNum(m.planned_qty), FP.fmtNum(m.good_qty),
          FP.fmtNum(m.reject_qty), m.ideal_cycle_sec ? String(m.ideal_cycle_sec) : '-', FP.fmtNum(m.downtime_min),
          runSec ? FP.fmtNum(runSec) : '-', FP.fmtPct(att, 0), eff === null ? '-' : `${eff.toFixed(1)}%`, cyc === null ? '-' : `${cyc.toFixed(1)}s`].map(T);
      }),
      foot: [['', 'Total', '', '', FP.fmtNum(k.plannedQty), FP.fmtNum(k.good), FP.fmtNum(k.reject), '', FP.fmtNum(k.down), '', FP.fmtPct(k.attainment, 0), '', '']],
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 22 }, 2: { cellWidth: 26 }, 3: { cellWidth: 20 } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 10) {
          const m = r.machines[d.row.index];
          const att = m.planned_qty ? (m.good_qty / m.planned_qty) * 100 : null;
          const c = STATUS_RGB[FP.statusOf('attainment', att)];
          if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = 'bold'; }
        }
      },
    });
    y = doc.lastAutoTable.finalY + 10;

    /* Downtime */
    heading('Downtime');
    if (r.downtime.length) {
      doc.autoTable({
        ...baseTable,
        startY: y,
        head: [['#', 'Machine', 'Reason', 'Minutes', 'Remarks']],
        body: r.downtime.map((d, i) => [i + 1, d.machine || '-', d.reason, FP.fmtNum(d.minutes), d.remarks || '-'].map(T)),
        foot: [['', '', 'Total', FP.fmtNum(r.downtime.reduce((s, d) => s + FP.int(d.minutes), 0)), '']],
        columnStyles: { 0: { cellWidth: 8 }, 3: { cellWidth: 20 } },
      });
      y = doc.lastAutoTable.finalY + 6;
      const sumW = 120;
      const totalDown = k.reasons.reduce((s, x) => s + x.minutes, 0) || 1;
      doc.autoTable({
        ...baseTable,
        startY: y,
        margin: centeredMargin(sumW),
        tableWidth: sumW,
        pageBreak: 'avoid',
        head: [['Loss by reason', 'Minutes', 'Share']],
        body: k.reasons.map((x) => [x.reason, FP.fmtNum(x.minutes), FP.fmtPct((x.minutes / totalDown) * 100, 0)].map(T)),
        headStyles: { ...baseTable.headStyles, fillColor: [70, 88, 104] },
      });
      y = doc.lastAutoTable.finalY + 10;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
      doc.text('No stoppages were recorded in this shift.', cx, y + 2, { align: 'center' });
      y += 12;
    }

    /* Rejections */
    heading('Rejection details');
    if (r.rejections.length) {
      doc.autoTable({
        ...baseTable,
        startY: y,
        margin: centeredMargin(150),
        tableWidth: 150,
        pageBreak: r.rejections.length <= 15 ? 'avoid' : 'auto',
        head: [['#', 'Part / item', 'Reason', 'Qty', 'Action']],
        body: r.rejections.map((x, i) => [i + 1, x.item || '-', x.reason, FP.fmtNum(x.qty), x.action].map(T)),
        foot: [['', '', 'Total', FP.fmtNum(k.rejBreakdown), '']],
        columnStyles: { 0: { cellWidth: 8 }, 3: { cellWidth: 16 }, 4: { cellWidth: 20 } },
      });
      y = doc.lastAutoTable.finalY + 10;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
      doc.text(k.reject ? `${FP.fmtNum(k.reject)} pieces rejected; no reason breakdown was entered.` : 'No rejections were recorded in this shift.', cx, y + 2, { align: 'center' });
      y += 12;
    }

    /* Remarks */
    if (r.remarks || r.next_actions) {
      heading('Remarks');
      const body = [];
      if (r.remarks) body.push([{ content: 'What happened this shift', styles: { fontStyle: 'bold', fillColor: TINT } }], [T(r.remarks)]);
      if (r.next_actions) body.push([{ content: 'Actions for next shift', styles: { fontStyle: 'bold', fillColor: TINT } }], [T(r.next_actions)]);
      doc.autoTable({ ...baseTable, startY: y, body, styles: { ...baseTable.styles, fontSize: 9, cellPadding: 3 }, alternateRowStyles: {} });
      y = doc.lastAutoTable.finalY + 10;
    }

    /* Sign-off */
    ensureSpace(30);
    y += 12;
    const sigW = 46;
    [['Prepared by', r.prepared_by || ''], ['Verified by', ''], ['Approved by', '']].forEach(([label, name], i) => {
      const sx = M + (CW / 3) * i + CW / 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
      if (name) doc.text(T(name), sx, y - 2, { align: 'center' });
      doc.setDrawColor(...MUTED); doc.setLineWidth(0.3);
      doc.line(sx - sigW / 2, y, sx + sigW / 2, y);
      doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(label, sx, y + 4.5, { align: 'center' });
    });

    /* Footer on every page */
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
      doc.line(M, H - 12, W - M, H - 12);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text(T(`FactoryPulse   |   ${r.report_no || 'Draft'}   |   Generated ${generated}   |   Page ${p} of ${pages}`), cx, H - 7, { align: 'center' });
    }
    return doc;
  }

  /* ----------------------------------------------------------- WhatsApp */
  function whatsappText(r) {
    const k = FP.computeKpis(r);
    const L = [];
    L.push('*DAILY PRODUCTION REPORT*');
    if (r.report_no) L.push(`Report no: ${r.report_no}`);
    L.push(`Date: ${FP.fmtDate(r.report_date)} | ${FP.shiftLabel(r.shift)}`);
    const place = [r.plant_name, r.section].filter(Boolean).join(' | ');
    if (place) L.push(`Plant: ${place}`);
    if (r.supervisor) L.push(`Supervisor: ${r.supervisor}`);
    L.push(`Planned time: ${r.planned_minutes} min per machine`);
    L.push('');
    L.push('*Shift performance*');
    L.push(`Plan attainment: ${FP.fmtPct(k.attainment)} (${FP.fmtNum(k.good)} good of ${FP.fmtNum(k.plannedQty)} planned)`);
    L.push(`OEE: ${FP.fmtPct(k.oee)} (A ${FP.fmtPct(k.availability, 0)} x P ${FP.fmtPct(k.performance, 0)} x Q ${FP.fmtPct(k.quality, 0)})`);
    L.push(`Rejection: ${FP.fmtPct(k.rejection)} (${FP.fmtNum(k.reject)} pcs)`);
    L.push(`Downtime: ${FP.fmtNum(k.down)} min`);
    if (k.manpowerRequired) L.push(`Manpower: ${k.manpowerPresent}/${k.manpowerRequired} present${r.overtime_hours ? `, OT ${r.overtime_hours} h` : ''}`);
    L.push('');
    L.push('*Machine-wise*');
    r.machines.forEach((m, i) => {
      const att = m.planned_qty ? FP.fmtPct((m.good_qty / m.planned_qty) * 100, 0) : '-';
      const runSec = m.actual_run_sec || 0;
      const eff = runSec > 0 ? `${(((28800 * (m.good_qty + m.reject_qty)) / runSec) * 100).toFixed(1)}%` : '-';
      const who = [m.item, m.operator && `Op: ${m.operator}`].filter(Boolean).join(', ');
      L.push(`${i + 1}. *${m.machine}*${who ? ` (${who})` : ''}`);
      L.push(`   Plan ${FP.fmtNum(m.planned_qty)} | Good ${FP.fmtNum(m.good_qty)} | Rej ${FP.fmtNum(m.reject_qty)} | Down ${FP.fmtNum(m.downtime_min)} min | ${att} | Eff ${eff}`);
    });
    if (r.downtime.length) {
      L.push('');
      L.push('*Downtime*');
      r.downtime.forEach((d) => L.push(`- ${d.machine}: ${d.reason}, ${d.minutes} min${d.remarks ? ` (${d.remarks})` : ''}`));
      if (k.reasons.length > 1) L.push(`Top loss: ${k.reasons[0].reason} (${k.reasons[0].minutes} min)`);
    }
    if (r.rejections.length) {
      L.push('');
      L.push('*Rejections*');
      r.rejections.forEach((x) => L.push(`- ${x.item ? x.item + ': ' : ''}${x.reason}, ${x.qty} pcs, ${x.action}`));
    }
    if (r.remarks) { L.push(''); L.push('*Remarks*'); L.push(r.remarks); }
    if (r.next_actions) { L.push(''); L.push('*Actions for next shift*'); L.push(r.next_actions); }
    L.push('');
    L.push(`_Prepared by ${r.prepared_by || 'FactoryPulse'}${r.report_no ? '' : ' (draft, not saved)'}_`);
    return L.join('\n');
  }

  FP.exporter = {
    pdf(r, btn) {
      if (!ensureData(r)) return;
      if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) {
        FP.toast('The PDF tool did not load. Refresh the page and try again.', { type: 'error' });
        return;
      }
      FP.busy(btn, true);
      setTimeout(() => {
        try {
          buildPdf(r).save(fileName(r));
          FP.toast('PDF downloaded.', { type: 'good' });
        } catch (e) {
          console.error(e);
          FP.toast('Could not create the PDF. Please try again.', { type: 'error' });
        } finally {
          FP.busy(btn, false);
        }
      }, 30);
    },

    whatsapp(r) {
      if (!ensureData(r)) return;
      let text = whatsappText(r);
      if (text.length > 60000) text = text.slice(0, 60000) + '\n…';
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      const win = window.open(url, '_blank');
      if (win) win.opener = null;
      else location.href = url; // pop-up blocked: open in this tab
    },

    buildPdf,
    whatsappText,
  };
})();
