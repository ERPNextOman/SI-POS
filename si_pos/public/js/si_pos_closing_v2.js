(function () {
    if (window.__si_pos_closing_v2_loaded) return;
    window.__si_pos_closing_v2_loaded = true;

    function is_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || $('.si-pos-wrap').closest('.page-wrapper').data('si_pos_instance') || null;
    }

    function company() {
        const i = inst();
        return i && i.company_field ? i.company_field.get_value() : null;
    }

    function money(value) {
        return format_currency(value || 0, frappe.defaults.get_default('currency') || 'OMR');
    }

    function rows_from_object(obj) {
        return Object.entries(obj || {}).map(([label, amount]) => `
            <tr><td>${frappe.utils.escape_html(label || 'Unspecified')}</td><td style="text-align:right;font-weight:900;">${money(amount)}</td></tr>
        `).join('') || '<tr><td colspan="2" class="text-muted">No entries</td></tr>';
    }

    function table_links(rows, type) {
        if (!rows || !rows.length) return '<tr><td colspan="4" class="text-muted">No records</td></tr>';
        return rows.slice(-20).reverse().map(row => {
            if (type === 'advance') {
                return `<tr><td><a href="/app/payment-entry/${encodeURIComponent(row.name)}" target="_blank">${frappe.utils.escape_html(row.name)}</a></td><td>${frappe.utils.escape_html(row.party || '')}</td><td>${frappe.utils.escape_html(row.mode_of_payment || '')}</td><td style="text-align:right;">${money(row.paid_amount)}</td></tr>`;
            }
            if (type === 'expense') {
                return `<tr><td><a href="/app/si-pos-daily-expense/${encodeURIComponent(row.name)}" target="_blank">${frappe.utils.escape_html(row.name)}</a></td><td>${frappe.utils.escape_html(row.purpose || '')}</td><td>${frappe.utils.escape_html(row.mode_of_payment || '')}</td><td style="text-align:right;">${money(row.amount)}</td></tr>`;
            }
            if (type === 'deposit') {
                return `<tr><td><a href="/app/si-pos-bank-deposit/${encodeURIComponent(row.name)}" target="_blank">${frappe.utils.escape_html(row.name)}</a></td><td>${frappe.utils.escape_html(row.bank_name || '')}</td><td>${frappe.utils.escape_html(row.from_mode_of_payment || '')}</td><td style="text-align:right;">${money(row.amount)}</td></tr>`;
            }
            return '';
        }).join('');
    }

    async function show_closing_v2() {
        try {
            const r = await frappe.call({
                method: 'si_pos.api.pos_actions.get_cashier_daily_closing',
                args: { company: company() },
                freeze: true,
                freeze_message: 'Loading daily closing...'
            });
            const data = r.message || {};

            const html = `
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Sales Total</div><div style="font-size:20px;font-weight:900;">${money(data.sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Cash Sales</div><div style="font-size:20px;font-weight:900;">${money(data.cash_sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Card / Other Sales</div><div style="font-size:20px;font-weight:900;">${money(data.card_sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;background:#ecfdf5;"><div class="text-muted">Expected Cash</div><div style="font-size:20px;font-weight:900;color:#047857;">${money(data.expected_cash)}</div></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Customer Advances</div><div style="font-size:20px;font-weight:900;">${money(data.advance_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Daily Expenses</div><div style="font-size:20px;font-weight:900;">${money(data.expense_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Bank Deposits</div><div style="font-size:20px;font-weight:900;">${money(data.deposit_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Outstanding</div><div style="font-size:20px;font-weight:900;">${money(data.outstanding_total)}</div></div>
                </div>
                <div class="alert alert-info" style="margin-bottom:12px;">
                    Expected Cash = Cash Sales + Cash Advances - Cash Expenses - Cash Bank Deposits
                </div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
                    <div><h5>Sales Payment Modes</h5><table class="table table-bordered table-sm"><tbody>${rows_from_object(data.mode_totals)}</tbody></table></div>
                    <div><h5>Advance Modes</h5><table class="table table-bordered table-sm"><tbody>${rows_from_object(data.advance_mode_totals)}</tbody></table></div>
                    <div><h5>Expense Modes</h5><table class="table table-bordered table-sm"><tbody>${rows_from_object(data.expense_mode_totals)}</tbody></table></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:12px;">
                    <div><h5>Recent Advances</h5><table class="table table-bordered table-sm"><thead><tr><th>PE</th><th>Customer</th><th>Mode</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${table_links(data.advances, 'advance')}</tbody></table></div>
                    <div><h5>Daily Expenses</h5><table class="table table-bordered table-sm"><thead><tr><th>Doc</th><th>Purpose</th><th>Mode</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${table_links(data.expenses, 'expense')}</tbody></table></div>
                    <div><h5>Bank Deposits</h5><table class="table table-bordered table-sm"><thead><tr><th>Doc</th><th>Bank</th><th>Mode</th><th style="text-align:right;">Amount</th></tr></thead><tbody>${table_links(data.deposits, 'deposit')}</tbody></table></div>
                </div>
            `;

            const d = new frappe.ui.Dialog({
                title: `Daily Closing - ${frappe.utils.escape_html(data.posting_date || '')}`,
                size: 'extra-large',
                fields: [{ fieldtype: 'HTML', fieldname: 'closing_html', options: html }],
                primary_action_label: 'Close',
                primary_action: () => d.hide()
            });
            d.show();
        } catch (e) {
            frappe.msgprint('Unable to load enhanced daily closing. Check permissions.');
        }
    }

    function bind() {
        if (!is_pos_page()) return;
        $(document).off('click.si_closing_v2').on('click.si_closing_v2', '.si-extra-closing-btn', show_closing_v2);
    }

    $(document).on('page-change', bind);
    $(document).ready(bind);
})();
