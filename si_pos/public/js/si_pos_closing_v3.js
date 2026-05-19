(function () {
    if (window.__si_pos_closing_v3_standalone_loaded) return;
    window.__si_pos_closing_v3_standalone_loaded = true;

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

    function warehouse() {
        const i = inst();
        return i && i.warehouse_field ? i.warehouse_field.get_value() : null;
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

    async function show_closing_v3(event) {
        if (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        try {
            const r = await frappe.call({
                method: 'si_pos.api.pos_actions.get_cashier_daily_closing',
                args: { company: company(), warehouse: warehouse() },
                freeze: true,
                freeze_message: 'Loading daily closing...'
            });
            const data = r.message || {};

            const cashShiftLink = data.cash_shift && data.cash_shift.name
                ? `<a href="/app/si-pos-cash-shift/${encodeURIComponent(data.cash_shift.name)}" target="_blank">${frappe.utils.escape_html(data.cash_shift.name)}</a>`
                : '<span class="text-danger">No open shift</span>';

            const html = `
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:12px;">
                    <div class="alert alert-warning" style="margin:0; flex:1;">
                        Cash Shift: ${cashShiftLink} | Opening Balance: <b>${money(data.opening_balance || 0)}</b>
                    </div>
                    <button class="btn btn-primary si-closing-denom-btn">Enter Closing Denomination</button>
                </div>

                <h4>Section 1 - Full Till Movement</h4>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Opening Balance</div><div style="font-size:20px;font-weight:900;">${money(data.opening_balance)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Total Sales</div><div style="font-size:20px;font-weight:900;">${money(data.sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Advance Received</div><div style="font-size:20px;font-weight:900;">${money(data.advance_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;background:#ecfdf5;"><div class="text-muted">Available Till Balance</div><div style="font-size:20px;font-weight:900;color:#047857;">${money(data.available_till_balance)}</div></div>
                </div>
                <table class="table table-bordered table-sm" style="margin-bottom:16px;">
                    <tbody>
                        <tr><td>Opening Balance</td><td style="text-align:right;">${money(data.opening_balance)}</td></tr>
                        <tr><td>+ Total Sales</td><td style="text-align:right;">${money(data.sales_total)}</td></tr>
                        <tr><td>+ Total Advance Received</td><td style="text-align:right;">${money(data.advance_total)}</td></tr>
                        <tr><td>- Daily Expenses</td><td style="text-align:right;">${money(data.expense_total)}</td></tr>
                        <tr><td>- Discount</td><td style="text-align:right;">${money(data.discount_total)}</td></tr>
                        <tr><td>- Bank Deposit</td><td style="text-align:right;">${money(data.deposit_total)}</td></tr>
                        <tr><th>Available Till Balance</th><th style="text-align:right;">${money(data.available_till_balance)}</th></tr>
                    </tbody>
                </table>

                <h4>Section 2 - Cash Till Balance</h4>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Opening Balance</div><div style="font-size:20px;font-weight:900;">${money(data.opening_balance)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Cash Sales</div><div style="font-size:20px;font-weight:900;">${money(data.cash_sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;background:#eff6ff;"><div class="text-muted">Till Available Balance</div><div style="font-size:20px;font-weight:900;color:#1d4ed8;">${money(data.till_available_balance)}</div></div>
                </div>
                <table class="table table-bordered table-sm" style="margin-bottom:16px;">
                    <tbody>
                        <tr><td>Opening Balance</td><td style="text-align:right;">${money(data.opening_balance)}</td></tr>
                        <tr><td>+ Cash Sales</td><td style="text-align:right;">${money(data.cash_sales_total)}</td></tr>
                        <tr><th>Till Available Balance</th><th style="text-align:right;">${money(data.till_available_balance)}</th></tr>
                    </tbody>
                </table>

                <h4>Other Summary</h4>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Card / Other Sales</div><div style="font-size:20px;font-weight:900;">${money(data.card_sales_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Discount</div><div style="font-size:20px;font-weight:900;">${money(data.discount_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Daily Expenses</div><div style="font-size:20px;font-weight:900;">${money(data.expense_total)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Bank Deposits</div><div style="font-size:20px;font-weight:900;">${money(data.deposit_total)}</div></div>
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
        $(document)
            .off('click.si_pos_extra_closing')
            .off('click.si_closing_v2')
            .off('click.si_closing_v3')
            .off('click.si_closing_v3_standalone')
            .on('click.si_closing_v3_standalone', '.si-extra-closing-btn', show_closing_v3);
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            bind();
            tries += 1;
            if (tries >= 80 || $('.si-extra-closing-btn').length) clearInterval(timer);
        }, 500);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
